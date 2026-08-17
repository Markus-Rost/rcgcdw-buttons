import { got, RefreshTokenError, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} rcid
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 * @throws {RefreshTokenError}
 */
export async function patrolEdit(wiki, context, rcid, forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'patrol', forceRefresh);
	if ( !tokens ) return context.get('patrol_error');
	let formData = {
		action: 'patrol', rcid,
		token: tokens.patroltoken,
		assert: 'user', errorlang: 'en',
		errorformat: 'plaintext',
		formatversion: 2, format: 'json'
	};
	return got.post( `${wiki}api.php`, {
		form: formData,
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.patrol?.rcid === rcid ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return patrolEdit(wiki, context, rcid, true);
				}
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' && error.text === 'The authorization headers in your request are not valid: Cannot create access token, user did not approve issuing this access token' ) ) {
					throw context.revoke();
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return patrolEdit(wiki, context, rcid, true);
				}
				if ( body.errors.some( error => error.code === 'blocked' ) ) {
					return context.get('error_blocked');
				}
				if ( body.errors.some( error => error.code === 'ratelimited' ) ) {
					return context.get('error_ratelimited');
				}
				if ( body.errors.some( error => error.code === 'patroldisabled' ) ) {
					return context.get('error_extension');
				}
				if ( body.errors.some( error => error.code === 'nosuchrcid' ) ) {
					return context.get('error_missingtitle');
				}
				if ( body.errors.some( error => error.code === 'notpatrollable' ) ) {
					return context.get('patrol_error_old');
				}
				if ( body.errors.some( error => error.code === 'noautopatrol' ) ) {
					return context.get('patrol_error_noauto');
				}
				if ( body.errors.some( error => error.code === 'permissiondenied' ) ) {
					return context.get('error_permissiondenied');
				}
			}
			console.log( `- ${response.statusCode}: Error while partolling on ${wiki}: ${parseErrors(response)}` );
			return context.get('patrol_error');
		}
		console.log( `${wiki} - ${context.userId} patrolled ${body.patrol.rcid} on ${body.patrol.title}` );
		return context.get('patrol_success');
	}, error => {
		console.log( `- Error while patrolling on ${wiki}: ${error}` );
		return context.get('patrol_error');
	} );
}
