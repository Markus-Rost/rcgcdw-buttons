import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {Context} context
 * @param {String} pageid
 * @param {String} user
 * @param {String} [summary]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<Boolean>}
 */
export async function rollbackPage(context, pageid, user, summary = '', forceRefresh = false) {
	let tokens = await getToken(context, 'rollback', forceRefresh);
	if ( !tokens ) return false;
	return got.post( `${context.wiki}api.php`, {
		form: {
			action: 'rollback',
			pageid, user, summary,
			token: tokens.rollbacktoken,
			assert: 'user', errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.rollback?.revid ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh() ) {
					return rollbackPage(context, pageid, user, summary, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return rollbackPage(context, pageid, user, summary, true);
				}
				if ( body.errors.some( error => error.code === 'alreadyrolled' ) ) {
				}
			}
			console.log( `- ${response.statusCode}: Error while reverting the page: ${parseErrors(response)}` );
			return false;
		}
		console.log( `- Reverted ${user} on ${context.wiki}/wiki/${body.rollback.title}` );
		return true;
	}, error => {
		console.log( `- Error while reverting the page: ${error}` );
		return false;
	} );
}
