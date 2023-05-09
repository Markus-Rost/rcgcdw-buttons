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
	if ( !tokens ) return context.get('rollback_error');
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
				if ( body.errors.some( error => ['missingtitle', 'nosuchpageid'].includes( error.code ) ) ) {
					return context.get('rollback_error_missingtitle');
				}
				if ( body.errors.some( error => error.code === 'onlyauthor' ) ) {
					return context.get('rollback_error_onlyauthor');
				}
				if ( body.errors.some( error => error.code === 'alreadyrolled' ) ) {
					return context.get('rollback_error_alreadyrolled');
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected'].includes( error.code ) ) ) {
					return context.get('error_permissiondenied');
				}
			}
			console.log( `- ${response.statusCode}: Error while reverting the page: ${parseErrors(response)}` );
			return context.get('rollback_error');
		}
		console.log( `${wiki} - Reverted ${user} on ${body.rollback.title}` );
		return context.get('rollback_success');
	}, error => {
		console.log( `- Error while reverting the page: ${error}` );
		return context.get('rollback_error');
	} );
}
