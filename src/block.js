import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} pageid
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function blockUser(context, user, forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'block', user,
			reason: '', expiry: 'never',
			nocreate: true, autoblock: true,
			token: tokens.csrftoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.block?.id ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return blockUser(context, user, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return blockUser(context, user, true);
				}
				if ( body.errors.some( error => error.code === 'alreadyblocked' ) ) {
					return false;
				}
			}
			console.log( `- ${response.statusCode}: Error while blocking the user: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Blocked ${context.wiki}/wiki/User:${body.block.user}` );
		return true;
	}, error => {
		console.log( `- Error while blocking the user: ${error}` );
		return false;
	} );
}