import { getMessage, db, enabledOAuth2, mwMessageCache, RefreshTokenError, Context, reply, sendButton, customDomainWikis } from './util.js';
import * as api from './api.js';

/** 
 * @param {import('discord-api-types/v10').APIMessageComponentGuildInteraction|import('discord-api-types/v10').APIModalSubmitGuildInteraction} interaction
 * @param {import('discord-api-types/v10').APIModalInteractionResponse} [result]
 */
export async function buttons(interaction, result = {data: {}}) {
	var parts = interaction.data.custom_id.split(' ');
	var hostname = interaction.message?.embeds?.[0]?.url?.split('/')[2];
	if ( !hostname ) hostname = interaction.message?.content?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	if ( !hostname ) hostname = interaction.message?.embeds?.[0]?.description?.match?.(/\]\(<?https:\/\/([^\/<>\[\]() ]+)\/[^<>() ]+>?\)/)?.[1];
	var userId = interaction.member?.user?.id;
	if ( !hostname || !userId || !parts[0].startsWith( '/' ) || !parts[0].endsWith( '/' ) || !api.allowedAction.has( parts[1] ) ) {
		result.type = 4;
		result.data.content = getMessage(interaction.locale, 'error_modified_message');
		return;
	}
	var oauthSite = hostname;
	if ( hostname.endsWith( '.wikimedia.org' ) ) oauthSite = 'wikimedia';
	else if ( hostname.endsWith( '.wiki.gg' ) ) oauthSite = 'wikigg';
	else if ( hostname.endsWith( '.miraheze.org' ) || customDomainWikis.miraheze.has(hostname) ) oauthSite = 'miraheze';
	else if ( hostname.endsWith( '.telepedia.net' ) ) oauthSite = 'telepedia';
	else if ( hostname.endsWith( '.wikioasis.org' ) ) oauthSite = 'wikioasis';
	else if ( hostname.endsWith( '.minecraft.wiki' ) ) oauthSite = 'minecraft.wiki';
	if ( !enabledOAuth2.has(oauthSite) ) {
		result.type = 4;
		result.data.content = getMessage(interaction.locale, 'error_unknown_site');
		return;
	}
	parts[0] = enabledOAuth2.get(oauthSite).script || parts[0];
	var wiki = `https://${hostname}${parts[0]}`;
	if ( interaction.type !== 5 && api.commentAction.has( parts[1] ) ) {
		let commentDropdown = api.commentDropdown.get( parts[1] );
		result.type = 9;
		result.data = {
			custom_id: interaction.data.custom_id,
			title: getMessage(interaction.locale, `modal_action_${parts[1]}`),
			components: []
		};
		let commentOptions = [];
		if ( commentDropdown ) {
			commentOptions = ( mwMessageCache.get(wiki)?.[commentDropdown] || '' ).split('\n').filter( option => option.startsWith( '**' ) ).map( option => {
				option = option.slice(2).trim().slice(0, 100);
				return {
					label: option,
					value: option,
					default: false
				}
			} ).slice(0, 24);
			if ( commentOptions.length ) result.data.components.push({
				type: 18,
				label: getMessage(interaction.locale, 'modal_reason'),
				component: {
					type: 3,
					custom_id: 'reason',
					min_values: 1,
					max_values: 1,
					required: true,
					options: [
						...commentOptions,
						{
							label: getMessage(interaction.locale, 'modal_reason_other'),
							value: 'other',
							default: true
						}
					]
				}
			});
		}
		result.data.components.push({
			type: 18,
			label: getMessage(interaction.locale, ( commentOptions.length ? 'modal_reason_other' : 'modal_reason') ),
			component: {
				type: 4,
				custom_id: 'reason_other',
				style: 1,
				min_length: 0,
				max_length: 500,
				required: false,
				placeholder: ( api.autocommentAction.has( parts[1] ) ? getMessage(interaction.locale, 'modal_reason_default') : '' )
			}
		});
		if ( api.expiryAction.has( parts[1] ) ) {
			let expiry = ( /^#\d+$/.test(parts.slice(2).join(' ')) ? 'infinite' : '2 weeks' );
			let expiryOptions = ( mwMessageCache.get(wiki)?.ipboptions || '2 hours:2 hours,1 day:1 day,3 days:3 days,1 week:1 week,2 weeks:2 weeks,1 month:1 month,3 months:3 months,6 months:6 months,1 year:1 year,indefinite:infinite' ).split(',').map( option => {
				let [label, value] = option.split(':');
				label = label.trim().slice(0, 100);
				value = value.trim().slice(0, 100) || label;
				return {
					label, value,
					description: ( label === value ? null : value ),
					default: value === expiry
				}
			} ).filter( (_, i, all) => i < 23 || i === all.length - 1 );
			result.data.components.push({
				type: 18,
				label: getMessage(interaction.locale, 'modal_expiry'),
				component: {
					type: 3,
					custom_id: 'expiry',
					min_values: 1,
					max_values: 1,
					required: true,
					options: [
						...expiryOptions,
						{
							label: getMessage(interaction.locale, 'modal_expiry_other'),
							value: 'other',
							default: !expiryOptions.some( option => option.default )
						}
					]
				}
			}, {
				type: 18,
				label: getMessage(interaction.locale, 'modal_expiry_other'),
				component: {
					type: 4,
					custom_id: 'expiry_other',
					style: 1,
					min_length: 0,
					max_length: 500,
					required: false,
					placeholder: '',
					value: ( expiryOptions.some( option => option.default ) ? '' : expiry )
				}
			});
		}
		return;
	}
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
		return sendButton(interaction, userId, oauthSite, wiki);
	} );
}

/** 
 * @param {import('discord-api-types/v10').APIMessageComponentGuildInteraction|import('discord-api-types/v10').APIModalSubmitGuildInteraction} interaction
 * @param {String} wiki
 * @param {Context} context
 */
async function actions(interaction, wiki, context) {
	var parts = interaction.data.custom_id.split(' ');
	/** @type {import('discord-api-types/v10').ModalSubmitComponent[]} */
	var components = interaction.data.components?.map( row => row.component ) || [];
	var reason = components.find( component => component.custom_id === 'reason' )?.values?.[0]?.trim() || '';
	var reasonOther = components.find( component => component.custom_id === 'reason_other' )?.value?.trim() || '';
	if ( reason && reasonOther ) reason += ': ';
	reason += reasonOther;
	var expiry = components.find( component => component.custom_id === 'expiry' )?.values?.[0]?.trim() || 'other';
	if ( expiry === 'other' ) expiry = components.find( component => component.custom_id === 'expiry_other' )?.value?.trim() || '';
	try {
		/** @type {import('discord-api-types/v10').APIInteractionResponseCallbackData} */
		var message = {
			content: context.get('error_modified_message'),
			flags: 1 << 6,
			components: [],
			allowed_mentions: {
				parse: []
			}
		};
		switch ( parts[1] ) {
			case 'thank':
				if ( api.thankAction.has( parts[2] ) && /^\d+$/.test(parts[3]) ) message.content = await api.thank(wiki, context, parts[2], parts[3]);
				break;
			case 'block':
				message.content = await api.block(wiki, context, parts.slice(2).join(' '), reason, expiry, true);
				break;
			case 'blocknotalk':
				message.content = await api.block(wiki, context, parts.slice(2).join(' '), reason, expiry, false);
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
	catch ( error ) {
		if ( error instanceof RefreshTokenError ) {
			return sendButton(interaction, context.userId, context.site, wiki);
		}
		throw error;
	}
}