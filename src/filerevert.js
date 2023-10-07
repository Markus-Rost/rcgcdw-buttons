import { got, Context, parseErrors } from './util.js';
import { getToken } from './token.js';

/** 
 * @param {String} wiki
 * @param {Context} context
 * @param {String} pageids
 * @param {String} timestamp
 * @param {String} [comment]
 * @param {Boolean} [forceRefresh]
 * @returns {Promise<String>}
 */
export async function revertFile(wiki, context, pageids, timestamp, comment = '', forceRefresh = false) {
	let tokens = await getToken(wiki, context, 'csrf', forceRefresh);
	if ( !tokens ) return context.get('filerevert_error');
	return got.get( `${wiki}api.php`, {
		searchParams: {
			action: 'query', pageids,
			assert: 'user', errorlang: 'en',
			errorformat: 'plaintext',
			formatversion: 2, format: 'json'
		},
		headers: {
			authorization: `Bearer ${context.accessToken}`
		}
	} ).then( async response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.query?.pages?.[0]?.title ) {
			if ( body?.errors?.length ) {
				if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
					return revertFile(wiki, context, pageids, timestamp, comment, true);
				}
			}
			console.log( `- ${response.statusCode}: Error while getting the file name on ${wiki}: ${parseErrors(response)}` );
			return context.get('filerevert_error');
		}
		var filename = body.query.pages[0].title.split(':').slice(1).join(':');
		return got.post( `${wiki}api.php`, {
			form: {
				action: 'filerevert', comment, filename,
				archivename: `${timestamp}!${filename}`,
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
			if ( response.statusCode !== 200 || body?.filerevert?.result !== 'Success' ) {
				if ( body?.errors?.length ) {
					if ( body.errors.some( error => error.code === 'mwoauth-invalid-authorization' ) && !forceRefresh && await context.refresh(wiki) ) {
						return revertFile(wiki, context, pageids, timestamp, comment, true);
					}
					if ( body.errors.some( error => error.code === 'badtoken' ) && !forceRefresh ) {
						return revertFile(wiki, context, pageids, timestamp, comment, true);
					}
					if ( body.errors.some( error => ['permissiondenied', 'protectedpage', 'cascadeprotected'].includes( error.code ) ) ) {
						return context.get('error_permissiondenied');
					}
				}
				console.log( `- ${response.statusCode}: Error while reverting the file on ${wiki}: ${parseErrors(response)}` );
				return context.get('filerevert_error');
			}
			console.log( `${wiki} - ${context.userId} reverted ${filename}` );
			return context.get('filerevert_success');
		}, error => {
			console.log( `- Error while reverting the file on ${wiki}: ${error}` );
			return context.get('filerevert_error');
		} );
	}, error => {
		console.log( `- Error while getting the file name on ${wiki}: ${error}` );
		return context.get('filerevert_error');
	} );
}