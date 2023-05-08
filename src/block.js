import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageid
 * @param {String} [reason]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function blockUser(wiki, context, user, reason = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return 'Error: I ran into an error while trying to block the user!';
	let expiry = ( /^#\d+$/.test(user) ? 'never' : '2 weeks' );
	return got.post( `${wiki}api.php`, {
		form: {
			action: 'block',
			user, reason, expiry,
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
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return blockUser(wiki, context, user, reason, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return blockUser(wiki, context, user, reason, true);
				}
				if ( body.errors.some( error => error.code === 'alreadyblocked' ) ) {
					return 'Error: The user is already blocked!';
				}
				if ( body.errors.some( error => ['permissiondenied', 'cantblock'].includes( error.code ) ) ) {
					return 'Error: You don\'t have the permission for this action!';
				}
			}
			console.log( `- ${response.statusCode}: Error while blocking the user: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to block the user!';
		}
		console.log( `${wiki} - Blocked ${body.block.user}` );
		return 'Success: The user has been blocked!';
	}, error => {
		console.log( `- Error while blocking the user: ${error}` );
		return 'Error: I ran into an error while trying to block the user!';
	} );
}