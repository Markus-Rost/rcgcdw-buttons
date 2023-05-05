import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} pageid
 * @param {String} [reason]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function deletePage(context, pageid, reason = '', forceRefresh = false) {
	let tokens = await getToken(context, 'csrf', forceRefresh);
	if ( !tokens ) return false;
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'delete',
			pageid, reason,
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
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return deletePage(context, pageid, reason, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return deletePage(context, pageid, reason, true);
				}
				if ( body.errors.some( error => error.code === 'cantdelete' ) ) {
				}
			}
			console.log( `- ${response.statusCode}: Error while deleting the page: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Deleted ${context.wiki}/wiki/${body.delete.title}` );
		return true;
	}, error => {
		console.log( `- Error while deleting the page: ${error}` );
		return false;
	} );
}