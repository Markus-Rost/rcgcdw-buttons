import { got, RefreshTokenError, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} target
 * @param {String} [reason]
 * @param {String} [expiry]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 * @throws {RefreshTokenError}
 */
export async function gblockUser(wiki, context, target, reason = '', expiry = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return context.get('gblock_error');
	expiry ||= ( /^#\d+$/.test(target) ? 'infinite' : '2 weeks' );
	if ( /^#\d+$/.test(target) ) {
		let result = await got.get( `${wiki}api.php`, {
			searchParams: {
				action: 'query', list: 'users',
				ususerids: target.slice(1),
				assert: 'user', errorlang: 'en',
				errorformat: 'plaintext',
				formatversion: 2, format: 'json'
			},
			headers: {
				authorization: `Bearer ${context.accessToken}`
			}
		} ).then( async response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body?.query?.users?.[0]?.name ) {
				if ( body?.errors?.length ) {
					if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
						return gblockUser(wiki, context, target, reason, expiry, true);
					}
					if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' && error.text === 'The authorization headers in your request are not valid: Cannot create access token, user did not approve issuing this access token' ) ) {
						throw context.revoke();
					}
				}
				console.log( `- ${response.statusCode}: Error while getting the username on ${wiki}: ${parseErrors(response)}` );
				return context.get('gblock_error');
			}
			target = body.query.users[0].name;
		}, error => {
			console.log( `- Error while getting the username on ${wiki}: ${error}` );
			return context.get('gblock_error');
		} );
		if ( result ) return result;
	}
	return got.post( `${wiki}api.php`, {
		form: {
			action: 'globalblock',
			target, reason, expiry,
			anononly: true,
			'enable-autoblock': true,
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
		if ( response.statusCode !== 200 || !body?.globalblock?.user ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return gblockUser(wiki, context, target, reason, expiry, true);
				}
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' && error.text === 'The authorization headers in your request are not valid: Cannot create access token, user did not approve issuing this access token' ) ) {
					throw context.revoke();
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return gblockUser(wiki, context, target, reason, expiry, true);
				}
				if ( body.errors.some( error => error.code === 'badexpiry' ) ) {
					return context.get('block_error_invalidexpiry');
				}
				if ( body.errors.some( error => error.code === 'globalblocking-block-alreadyblocked' ) ) {
					return context.get('gblock_error_alreadyblocked');
				}
				if ( body.errors.some( error => error.code === 'permissiondenied' ) ) {
					return context.get('error_permissiondenied');
				}
			}
			if ( body?.error?.globalblock?.length ) {
				if ( body.error.globalblock.some( error => error.code === 'globalblocking-block-alreadyblocked' ) ) {
					return context.get('gblock_error_alreadyblocked');
				}
			}
			console.log( `- ${response.statusCode}: Error while globally blocking the user on ${wiki}: ${parseErrors(response)}` );
			return context.get('gblock_error');
		}
		console.log( `${wiki} - ${context.userId} globally blocked ${body.globalblock.user}` );
		return context.get('gblock_success');
	}, error => {
		console.log( `- Error while globally blocking the user on ${wiki}: ${error}` );
		return context.get('gblock_error');
	} );
}