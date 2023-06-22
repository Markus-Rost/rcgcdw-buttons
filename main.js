import 'dotenv/config';
import { createServer, STATUS_CODES } from 'node:http';
import { subtle } from 'node:crypto';
import { REDIRECT_URI_WIKI, getMessage, db, got, enabledOAuth2, oauthVerify, customDomainWikis } from './src/util.js';
import { buttons } from './src/index.js';

const PUBLIC_KEY = ( process.env.key ? await subtle.importKey('raw', Buffer.from(process.env.key, 'hex'), 'Ed25519', true, ['verify']).catch(console.log) : null );
const REDIRECT_URI_DISCORD = new URL(process.env.interactions_path, process.env.redirect_uri).href;

const oauthURL = `https://discord.com/oauth2/authorize?` + new URLSearchParams({
	response_type: 'code',
	scope: 'webhook.incoming',
	client_id: process.env.bot,
	redirect_uri: REDIRECT_URI_DISCORD
}).toString();

const server = createServer( (req, res) => {
	res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
	res.setHeader('Content-Type', 'text/html');
	res.setHeader('Content-Language', ['en']);

	if ( req.method === 'POST' && req.url === process.env.interactions_path ) {
		let body = [];
		req.on( 'data', chunk => {
			body.push(chunk);
		} );
		req.on( 'error', () => {
			console.log( error );
			res.end('error');
		} );
		return req.on( 'end', async () => {
			var rawBody = Buffer.concat(body).toString();
			try {
				let signature = req.headers['x-signature-ed25519'];
				let timestamp = req.headers['x-signature-timestamp'];
				if ( req.headers.authorization !== process.env.token && ( !PUBLIC_KEY || !signature || !timestamp
				 || !await subtle.verify('Ed25519', PUBLIC_KEY, Buffer.from(signature, 'hex'), Buffer.from(timestamp + rawBody)) ) ) {
					res.statusCode = 401;
					return res.end();
				}
			}
			catch ( verifyerror ) {
				console.log( verifyerror );
				res.statusCode = 401;
				return res.end();
			}
			try {
				var interaction = JSON.parse(rawBody);
				res.statusCode = 200;
				var result = {
					data: {
						flags: 1 << 6,
						allowed_mentions: {
							parse: []
						}
					}
				};
				switch ( interaction.type ) {
					case 1:
						result.type = 1;
						break;
					case 5:
						await buttons(interaction, result);
						break;
					case 3:
						if ( interaction.data?.component_type === 2 ) {
							await buttons(interaction, result);
							break;
						}
					default:
						result.type = 4;
						result.data.content = getMessage(interaction.locale, 'error_unknown_interaction');
				}
				let response = JSON.stringify(result);
				if ( req.headers.authorization === process.env.token ) {
					if ( result.data?.custom_id ) result.data.custom_id = `rc_${result.data.custom_id}`;
					got.post( `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`, {
						json: result,
						throwHttpErrors: true
					} ).catch( error => {
						console.log( `- Error while responding to the interaction: ${error}` );
					} );
					response = '{"result": "Success"}';
				}
				res.writeHead(200, {
					'Content-Length': Buffer.byteLength(response),
					'Content-Type': 'application/json'
				});
				res.write( response );
				res.end();
			}
			catch ( jsonerror ) {
				console.log( jsonerror );
				res.statusCode = 500;
				return res.end();
			}
		} );
	}

	if ( req.method !== 'GET' ) {
		let body = '<img width="400" src="https://http.cat/418"><br><strong>' + STATUS_CODES[418] + '</strong>';
		res.writeHead(418, {
			'Content-Length': Buffer.byteLength(body)
		});
		res.write( body );
		return res.end();
	}

	var reqURL = new URL(req.url, process.env.redirect_uri);

	if ( reqURL.pathname === process.env.wiki_path ) {
		if ( !reqURL.searchParams.get('code') || !reqURL.searchParams.get('state') ) {
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		}
		let state = reqURL.searchParams.get('state');
		let site = state.split(' ');
		let oauthSite = enabledOAuth2.get(site[0]);
		if ( !oauthSite || !oauthVerify.has(state) ) {
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		}
		let url = oauthSite.url;
		if ( new RegExp( `^https://[a-z0-9\\.-]*\\b${oauthSite.id}\\b.*/$` ).test(site[2]) ) url = site[2];
		else if ( oauthSite.id === 'miraheze' && customDomainWikis.miraheze.has(site[2]?.split('/')[2]) ) url = site[2];
		else if ( oauthSite.id === 'wikitide' && customDomainWikis.wikitide.has(site[2]?.split('/')[2]) ) url = site[2];
		return got.post( `${url}rest.php/oauth2/access_token`, {
			form: {
				grant_type: 'authorization_code',
				code: reqURL.searchParams.get('code'),
				redirect_uri: REDIRECT_URI_WIKI,
				client_id: process.env[`oauth_${oauthSite.id}`],
				client_secret: process.env[`oauth_${oauthSite.id}_secret`]
			}
		} ).then( response => {
			var body = response.body;
			if ( response.statusCode !== 200 || !body?.access_token ) {
				console.log( `- RcGcDw buttons: ${response.statusCode}: Error while getting the OAuth2 token on ${url}: ${body?.message||body?.error}` );
				res.writeHead(302, {Location: '/?oauth=failed'});
				return res.end();
			}
			let data = oauthVerify.get(state);
			db.query( 'INSERT INTO oauthrevert(userid, site, access, refresh) VALUES ($1, $2, $3, $4)', [data.userId, oauthSite.id, body.access_token, body.refresh_token] ).then( () => {
				console.log( `- RcGcDw buttons: OAuth2 token for ${data.userId} on ${oauthSite.id} successfully saved.` );
				buttons(data.interaction);
			}, dberror => {
				console.log( `- RcGcDw buttons: Error while saving the OAuth2 token for ${data.userId} on ${oauthSite.id}: ${dberror}` );
			} );
			oauthVerify.delete(state);
			res.writeHead(302, {Location: '/?oauth=success'});
			return res.end();
		}, error => {
			console.log( `- RcGcDw buttons: Error while getting the OAuth2 token on ${url}: ${error}` );
			res.writeHead(302, {Location: '/?oauth=failed'});
			return res.end();
		} );
	}

	if ( !reqURL.searchParams.get('code') || !reqURL.searchParams.get('guild_id') ) {
		res.writeHead(302, {Location: oauthURL});
		return res.end();
	}
	return got.post( 'https://discord.com/api/oauth2/token', {
		form: {
			grant_type: 'authorization_code',
			code: reqURL.searchParams.get('code'),
			redirect_uri: REDIRECT_URI_DISCORD,
			client_id: process.env.bot,
			client_secret: process.env.secret
		}
	} ).then( response => {
		var body = response.body;
		if ( response.statusCode !== 200 || !body?.webhook?.url || body.webhook.guild_id !== reqURL.searchParams.get('guild_id') ) {
			console.log( `- RcGcDw buttons: ${response.statusCode}: Error while getting the webhook url: ${body?.message||body?.error}` );
			res.writeHead(302, {Location: oauthURL});
			return res.end();
		}
		console.log( '- RcGcDw buttons: Webhook successfully created!' );
		let text = `<body style="display: flex; justify-content: center; align-items: center;"><code style="user-select: all;">${body.webhook.url}</code></body>`;
		res.writeHead(200, {
			'Content-Length': Buffer.byteLength(text)
		});
		res.write( text );
		return res.end();
	}, error => {
		console.log( `- RcGcDw buttons: Error while getting the webhook url: ${error}` );
		res.writeHead(302, {Location: oauthURL});
		return res.end();
	} );
} );

server.listen( process.env.server_port, process.env.server_hostname, () => {
	console.log( `- RcGcDw buttons: Server running at http://${process.env.server_hostname}:${process.env.server_port}/` );
} );

process.on( 'warning', warning => {
	if ( warning?.name === 'ExperimentalWarning' ) return;
	console.log(`- Warning: ${warning}`);
} );

/**
 * End the process gracefully.
 * @param {NodeJS.Signals} signal - The signal received.
 */
function graceful(signal) {
	console.log(signal);
	server.close( () => {
		console.log( '- ' + signal + ': Closed the server.' );
		db.end().then( () => {
			console.log( '- ' + signal + ': Closed the database connection.' );
			process.exit(0);
		}, dberror => {
			console.log( '- ' + signal + ': Error while closing the database connection: ' + dberror );
		} );
	} );
}

process.on( 'SIGHUP', graceful );
process.on( 'SIGINT', graceful );
process.on( 'SIGTERM', graceful );
process.on( 'SIGINT SIGTERM', graceful );