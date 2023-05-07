import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageid
 * @param {String} user
 * @param {String} [summary]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function rollbackPage(wiki, context, pageid, user, summary = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'rollback', forceRefresh);
	if ( !tokens ) return 'Error: I ran into an error while trying to rollback the page!';
	return got.post( `${wiki}api.php`, {
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
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return rollbackPage(wiki, context, pageid, user, summary, true);
				}
				if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
					return rollbackPage(wiki, context, pageid, user, summary, true);
				}
				if ( body.errors.some( error => error.code === 'onlyauthor' ) ) {
					return 'Error: The user is the only editor of this page!';
				}
				if ( body.errors.some( error => error.code === 'alreadyrolled' ) ) {
					return 'Error: The user was not the last one to edit this page or there were no changes to roll back!';
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected'].includes( error.code ) ) ) {
					return 'Error: You don\'t have the permission for this action!';
				}
			}
			console.log( `- ${response.statusCode}: Error while reverting the page: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to rollback the page!';
		}
		console.log( `- Reverted ${user} on ${body.rollback.title} of ${wiki}` );
		return 'Success: The page has been rolled back!';
	}, error => {
		console.log( `- Error while reverting the page: ${error}` );
		return 'Error: I ran into an error while trying to rollback the page!';
	} );
}
