import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageid
 * @param {String} [reason]
 * @param {String} [expiry]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function blockUser(wiki, context, user, reason = '', expiry = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return context.get('block_error');
	expiry ||= ( /^#\d+$/.test(user) ? 'never' : '2 weeks' );
	return got.post( `${wiki}api.php`, {
		form: {
			action: 'block',
			user, reason, expiry,
			anononly: true, nocreate: true,
			autoblock: true, allowusertalk: true,
			token: tokens.csrftoken,
			assert: 'user', errorlang: 'en',
			errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.block?.id ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return blockUser(wiki, context, user, reason, expiry, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return blockUser(wiki, context, user, reason, expiry, true);
				}
				if ( body.errors.some( error => error.code === 'invalidexpiry' ) ) {
					return context.get('block_error_invalidexpiry');
				}
				if ( body.errors.some( error => error.code === 'alreadyblocked' ) ) {
					return context.get('block_error_alreadyblocked');
				}
				if ( body.errors.some( error => ['permissiondenied', 'cantblock'].includes( error.code ) ) ) {
					return context.get('error_permissiondenied');
				}
			}
			console.log( `- ${response.statusCode}: Error while blocking the user on ${wiki}: ${parseErrors(response)}` );
			return context.get('block_error');
		}
		console.log( `${wiki} - ${context.userId} blocked ${body.block.user}` );
		return context.get('block_success');
	}, error => {
		console.log( `- Error while blocking the user on ${wiki}: ${error}` );
		return context.get('block_error');
	} );
}