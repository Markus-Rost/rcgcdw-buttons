import { randomBytes } from 'node:crypto';
import { db, oauthVerify, Context, reply } from './util.js';
import * as api from './api.js';

export async function buttons(interaction, result) {
	var parts = interaction.data.custom_id.split(' ');
	var hostname = interaction.message?.embeds?.[0]?.url?.split('/')[2];
	if ( !hostname ) hostname = interaction.message?.content?.match?.(/\]\(<https:\/\/([^\/<>\[\]() ]+)\/[^<> ]+>\)/)?.[1];
	var userId = interaction.member?.user?.id;
	if ( !hostname || !userId || !parts[0].startsWith( '/' ) || !parts[0].endsWith( '/' ) ) {
		result.type = 4;
		result.data.content = 'Error: Modified message!';
		return;
	}
	var wiki = `https://${hostname}${parts[0]}`;
	var oauthSite = hostname + parts[0].slice(0, -1);
	var oauthKey = oauthSite;
	if ( hostname.endsWith( '.wikimedia.org' ) ) oauthKey = 'wikimedia';
	else if ( hostname.endsWith( '.miraheze.org' ) ) oauthKey = 'miraheze';
	else if ( hostname.endsWith( '.wikiforge.net' ) ) oauthKey = 'wikiforge';
	if ( !process.env[`oauth_${oauthKey}`] || !process.env[`oauth_${oauthKey}_secret`] ) {
		result.type = 4;
		result.data.content = 'Error: Site not supported!';
		return;
	}
	result.type = 5;
	let cacheKey = `${wiki} ${userId} ${oauthKey}`;
	if ( Context._cache.has(cacheKey) ) {
		actions(interaction, Context._cache.get(cacheKey));
		return;
	}
	db.query( 'SELECT access, refresh, userid, site FROM oauthrevert WHERE userid = $1 AND site = $2', [userId, oauthKey] ).then( ({rows: [row]}) => {
		if ( !row ) return Promise.reject();
		actions(interaction, new Context(wiki, row));
	}, dberror => {
		console.log( `- Error while getting the OAuth2 token: ${dberror}` );
		return Promise.reject();
	} ).catch( () => {
		let state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')}` + ( oauthKey !== oauthSite ? ` ${oauthKey}` : '' );
		while ( oauthVerify.has(state) ) {
			state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')}` + ( oauthKey !== oauthSite ? ` ${oauthKey}` : '' );
		}
		oauthVerify.set(state, userId);
		let oauthURL = `${wiki}rest.php/oauth2/authorize?` + new URLSearchParams({
			response_type: 'code', redirect_uri: new URL('/oauth', process.env.dashboard).href,
			client_id: process.env[`oauth_${oauthKey}`], state
		}).toString();
		let message = {
			content: `<${oauthURL}>`,
			components: [{
				type: 1,
				components: [{
					type: 2,
					label: 'Authorize',
					style: 5,
					url: oauthURL,
					emoji: {
						id: null,
						name: '🔗'
					}
				}]
			}],
			flags: 1 << 6,
			allowed_mentions: {
				parse: []
			}
		};
		return reply(interaction, message);
	} );
}

async function actions(interaction, context) {

}