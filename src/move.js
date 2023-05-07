import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} fromid
 * @param {String} to
 * @param {String} [reason]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function movePage(wiki, context, fromid, to, reason = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return 'Error: I ran into an error while trying to move the page back!';
	return got.post( `${wiki}api.php`, {
		form: {
			action: 'move', fromid, to,
			reason, noredirect: true,
			token: tokens.csrftoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.move?.to ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return movePage(wiki, context, fromid, to, reason, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return movePage(wiki, context, fromid, to, reason, true);
				}
				if ( body.errors.some( error => error.code === 'selfmove' ) ) {
					return 'Error: The page is already back under this title!';
				}
				if ( body.errors.some( error => error.code === 'articleexists' ) ) {
					return 'Error: There is already a different page under this title!';
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected', 'protectedtitle', 'cantmove', 'cantmovefile', 'cantmovefile'].includes( error.code ) ) ) {
					return 'Error: You don\'t have the permission for this action!';
				}
			}
			console.log( `- ${response.statusCode}: Error while moving the page: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to move the page back!';
		}
		console.log( `- Moved ${body.move.from} to ${body.move.to} on ${wiki}` );
		return 'Success: The page has been moved back!';
	}, error => {
		console.log( `- Error while moving the page: ${error}` );
		return 'Error: I ran into an error while trying to move the page back!';
	} );
}