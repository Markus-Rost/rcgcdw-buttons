import { randomBytes } from 'node:crypto';
import { REDIRECT_URI_WIKI, getMessage, db, enabledOAuth2, oauthVerify, Context, reply, mirahezeWikis } from './util.js';
import * as api from './api.js';

/** 
 * @param {Object} interaction
 * @param {Object} [result]
 */
export async function buttons(interaction, result = {data: {}}) {
	var parts = interaction.data.custom_id.split(' ');
	var hostname = interaction.message?.embeds?.[0]?.url?.split('/')[2];
	if ( !hostname ) hostname = interaction.message?.content?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	if ( !hostname ) hostname = interaction.message?.embeds?.[0]?.description?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	var userId = interaction.member?.user?.id;
	if ( !hostname || !userId || !parts[0].startsWith( '/' ) || !parts[0].endsWith( '/' ) || !api.allowedAction.includes( parts[1] ) ) {
		result.type = 4;
		result.data.content = getMessage(interaction.locale, 'error_modified_message');
		return;
	}
	var oauthSite = hostname;
	if ( hostname.endsWith( '.wikimedia.org' ) ) oauthSite = 'wikimedia';
	else if ( hostname.endsWith( '.wiki.gg' ) ) oauthSite = 'wikigg';
	else if ( hostname.endsWith( '.miraheze.org' ) || mirahezeWikis.has(hostname) ) oauthSite = 'miraheze';
	else if ( hostname.endsWith( '.wikiforge.net' ) ) oauthSite = 'wikiforge';
	if ( !enabledOAuth2.has(oauthSite) ) {
		result.type = 4;
		result.data.content = getMessage(interaction.locale, 'error_unknown_site');
		return;
	}
	parts[0] = enabledOAuth2.get(oauthSite).script || parts[0];
	if ( interaction.type !== 5 ) {
		result.type = 9;
		result.data = {
			custom_id: interaction.data.custom_id,
			title: getMessage(interaction.locale, `modal_action_${parts[1]}`),
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'reason',
					style: 1,
					label: getMessage(interaction.locale, 'modal_reason'),
					min_length: 0,
					max_length: 500,
					required: false,
					placeholder: ( api.autocommentAction.includes( parts[1] ) ? getMessage(interaction.locale, 'modal_reason_default') : '' )
				}]
			}]
		};
		return;
	}
	var wiki = `https://${hostname}${parts[0]}`;
	result.type = 5;
	let cacheKey = `${userId} ${oauthSite}`;
	if ( Context._cache.has(cacheKey) ) {
		actions(interaction, wiki, Context._cache.get(cacheKey).updateLocale(interaction.locale));
		return;
	}
	db.query( 'SELECT access, refresh, userid, site FROM oauthrevert WHERE userid = $1 AND site = $2', [userId, oauthSite] ).then( ({rows: [row]}) => {
		if ( !row ) return Promise.reject();
		actions(interaction, wiki, new Context(row, interaction.locale));
	}, dberror => {
		console.log( `- Error while getting the OAuth2 token: ${dberror}` );
		return Promise.reject();
	} ).catch( () => {
		let state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')} ${wiki}`;
		while ( oauthVerify.has(state) ) {
			state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')} ${wiki}`;
		}
		oauthVerify.set(state, {userId, interaction});
		let oauthURL = `${wiki}rest.php/oauth2/authorize?` + new URLSearchParams({
			response_type: 'code', state,
			redirect_uri: REDIRECT_URI_WIKI,
			client_id: process.env[`oauth_${oauthSite}`]
		}).toString();
		let message = {
			content: `[${getMessage(interaction.locale, 'oauth_message')}](<${oauthURL}>)`,
			components: [{
				type: 1,
				components: [{
					type: 2,
					label: getMessage(interaction.locale, 'oauth_button'),
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

/** 
 * @param {Object} interaction
 * @param {String} wiki
 * @param {Context} context
 */
async function actions(interaction, wiki, context) {
	var parts = interaction.data.custom_id.split(' ');
	var reason = interaction.data.components?.find( row => {
		return row.components?.find?.( component => component.custom_id === 'reason' );
	} )?.components.find( component => component.custom_id === 'reason' )?.value || '';
	var message = {
		content: context.get('error_modified_message'),
		flags: 1 << 6,
		components: [],
		allowed_mentions: {
			parse: []
		}
	};
	switch ( parts[1] ) {
		case 'block':
			message.content = await api.block(wiki, context, parts.slice(2).join(' '), reason);
			break;
		case 'delete':
			if ( /^\d+$/.test(parts[2]) ) message.content = await api.delete(wiki, context, parts[2], reason);
			break;
		case 'move':
			if ( /^\d+$/.test(parts[2]) ) message.content = await api.move(wiki, context, parts[2], parts.slice(3).join(' '), reason);
			break;
		case 'rollback':
			if ( /^\d+$/.test(parts[2]) ) message.content = await api.rollback(wiki, context, parts[2], parts.slice(3).join(' '), reason);
			break;
		case 'file':
			if ( /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3]) ) message.content = await api.filerevert(wiki, context, parts[2], parts[3], reason);
			break;
		case 'undo':
			if ( /^\d+$/.test(parts[2]) && /^\d+$/.test(parts[3]) ) message.content = await api.undo(wiki, context, parts[2], parts[3], reason);
			break;
	}
	reply(interaction, message);
}