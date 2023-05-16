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
	if ( !tokens ) return context.get('move_error');
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
				if ( body.errors.some( error => ['missingtitle', 'nosuchpageid'].includes( error.code ) ) ) {
					return context.get('error_missingtitle');
				}
				if ( body.errors.some( error => error.code === 'selfmove' ) ) {
					return context.get('move_error_selfmove');
				}
				if ( body.errors.some( error => error.code === 'articleexists' ) ) {
					return context.get('move_error_articleexists');
				}
				if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected', 'protectedtitle', 'cantmove', 'cantmovefile', 'cantmovefile'].includes( error.code ) ) ) {
					return context.get('error_permissiondenied');
				}
			}
			console.log( `- ${response.statusCode}: Error while moving the page on ${wiki}: ${parseErrors(response)}` );
			return context.get('move_error');
		}
		console.log( `${wiki} - ${context.userId} moved ${body.move.from} to ${body.move.to}` );
		return context.get('move_success');
	}, error => {
		console.log( `- Error while moving the page on ${wiki}: ${error}` );
		return context.get('move_error');
	} );
}