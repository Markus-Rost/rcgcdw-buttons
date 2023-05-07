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
	if ( !tokens ) return 'Error: I ran into an error while trying to revert the file version!';
	return got.get( `${wiki}api.php`, {
		searchParams: {
			action: 'query', pageids,
			assert: 'user', errorformat: 'plaintext',
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
			console.log( `- ${response.statusCode}: Error while getting the file name: ${parseErrors(response)}` );
			return 'Error: I ran into an error while trying to revert the file version!';
		}
		var filename = body.query.pages[0].title.split(':').slice(1).join(':');
		return got.post( `${wiki}api.php`, {
			form: {
				action: 'filerevert', comment, filename,
				archivename: `${timestamp}!${filename}`,
				token: tokens.csrftoken,
				assert: 'user', errorformat: 'plaintext',
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
						return 'Error: You don\'t have the permission for this action!';
					}
				}
				console.log( `- ${response.statusCode}: Error while reverting the file: ${parseErrors(response)}` );
				return 'Error: I ran into an error while trying to revert the file version!';
			}
			console.log( `- Reverted ${filename} on ${wiki}` );
			return 'Success: The file version has been reverted!';
		}, error => {
			console.log( `- Error while reverting the file: ${error}` );
			return 'Error: I ran into an error while trying to revert the file version!';
		} );
	}, error => {
		console.log( `- Error while getting the file name: ${error}` );
		return 'Error: I ran into an error while trying to revert the file version!';
	} );
}