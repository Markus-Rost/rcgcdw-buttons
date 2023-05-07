import { randomBytes } from 'node:crypto';
import { db, oauthVerify, Context, reply } from './util.js';
import * as api from './api.js';

export async function buttons(interaction, result = {data: {}}) {
	var parts = interaction.data.custom_id.split(' ');
	var hostname = interaction.message?.embeds?.[0]?.url?.split('/')[2];
	if ( !hostname ) hostname = interaction.message?.content?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	if ( !hostname ) hostname = interaction.message?.embeds?.[0]?.description?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	var userId = interaction.member?.user?.id;
	if ( !hostname || !userId || !parts[0].startsWith( '/' ) || !parts[0].endsWith( '/' ) || !api.allowedAction.includes( parts[1] ) ) {
		result.type = 4;
		result.data.content = 'Error: Modified message!';
		return;
	}
	var oauthSite = '';
	if ( hostname.endsWith( '.wikimedia.org' ) ) {
		oauthSite = 'wikimedia';
		parts[0] = '/w/';
	}
	else if ( hostname.endsWith( '.miraheze.org' ) ) {
		oauthSite = 'miraheze';
		parts[0] = '/w/';
	}
	else if ( hostname.endsWith( '.wikiforge.net' ) ) {
		oauthSite = 'wikiforge';
		parts[0] = '/w/';
	}
	if ( !oauthSite || !process.env[`oauth_${oauthSite}`] || !process.env[`oauth_${oauthSite}_secret`] ) {
		result.type = 4;
		result.data.content = 'Error: Site not supported!';
		return;
	}
	if ( interaction.type !== 5 ) {
		let title = 'Unknown action';
		switch ( parts[1] ) {
			case 'block':
				title = 'Block user';
				break;
			case 'delete':
				title = 'Delete page';
				break;
			case 'move':
				title = 'Move page back';
				break;
			case 'rollback':
				title = 'Rollback page';
				break;
			case 'file':
				title = 'Revert file version';
				break;
			case 'undo':
				title = 'Undo edit';
				break;
		}
		result.type = 9;
		result.data = {
			custom_id: interaction.data.custom_id, title,
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'reason',
					style: 1,
					label: 'Reason',
					min_length: 0,
					max_length: 500,
					required: false,
					placeholder: ( api.autocommentAction.includes( parts[1] ) ? '(default auto generated reason)' : '' )
				}]
			}]
		};
		return;
	}
	var wiki = `https://${hostname}${parts[0]}`;
	result.type = 5;
	let cacheKey = `${userId} ${oauthSite}`;
	if ( Context._cache.has(cacheKey) ) {
		actions(interaction, wiki, Context._cache.get(cacheKey));
		return;
	}
	db.query( 'SELECT access, refresh, userid, site FROM oauthrevert WHERE userid = $1 AND site = $2', [userId, oauthSite] ).then( ({rows: [row]}) => {
		if ( !row ) return Promise.reject();
		actions(interaction, wiki, new Context(row));
	}, dberror => {
		console.log( `- Error while getting the OAuth2 token: ${dberror}` );
		return Promise.reject();
	} ).catch( () => {
		let state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')}`;
		while ( oauthVerify.has(state) ) {
			state = `${oauthSite} ${Date.now().toString(16)}${randomBytes(16).toString('hex')}`;
		}
		oauthVerify.set(state, {userId, interaction});
		let oauthURL = `${wiki}rest.php/oauth2/authorize?` + new URLSearchParams({
			response_type: 'code', redirect_uri: new URL('/oauth', process.env.dashboard).href,
			client_id: process.env[`oauth_${oauthSite}`], state
		}).toString();
		let message = {
			content: `[Please authorize me to make changes on the wiki in your name!](<${oauthURL}>)`,
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

async function actions(interaction, wiki, context) {
	var parts = interaction.data.custom_id.split(' ');
	var reason = interaction.data.components?.find( row => {
		return row.components?.find?.( component => component.custom_id === 'reason' );
	} )?.components.find( component => component.custom_id === 'reason' )?.value || '';
	var message = {
		content: 'Error: Modified message!',
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