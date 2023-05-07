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
export async function deletePage(wiki, context, pageid, reason = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return 'Error: I ran into an error while trying to delete the page!';
	return got.post( `${wiki}api.php`, {
		form: {
			action: 'delete', pageid, reason,
			token: tokens.csrftoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.delete?.logid ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return deletePage(wiki, context, pageid, reason, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return deletePage(wiki, context, pageid, reason, true);
				}
				if ( body.errors.some( error => ['missingtitle', 'cantdelete'].includes( error.code ) ) ) {
					return 'Error: The page has already been deleted!';
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected'].includes( error.code ) ) ) {
					return 'Error: You don\'t have the permission for this action!';
				}
			}
			console.log( `- ${response.statusCode}: Error while deleting the page: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to delete the page!';
		}
		console.log( `${wiki} - Deleted ${body.delete.title}` );
		return 'Success: The page has been deleted!';
	}, error => {
		console.log( `- Error while deleting the page: ${error}` );
		return 'Error: I ran into an error while trying to delete the page!';
	} );
}