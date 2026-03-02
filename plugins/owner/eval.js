import { inspect, format } from 'util'
import { exec as _exec } from 'child_process'

export default {
    name: 'eval',
    noPrefix: true,
    ownerOnly: true,
    silentUnauthorized: true,
    description: 'Eval JS / shell — hanya owner',

    match: (body) =>
        body.startsWith('=>') ||
        (body.startsWith('>') && !body.startsWith('=>')) ||
        body.startsWith('$'),

    execute: async ({
        sock, msg, body, react, useLimit,
        config, usersDb, groupsDb, user,
        sender, botJid, pushName,
        isOwner, isPremium, isGroup, isAdmin, isBotAdmin,
        groupMetadata, mimetype,
        isQuoted, quotedMsg, quotedType, quotedMimetype, contextInfo,
    }) => {
        const jid    = msg.key.remoteJid
        const reply  = (text) => sock.sendMessage(jid, { text: String(text) }, { quoted: msg })
        const m   = msg
        const db  = usersDb
        const gdb = groupsDb
        const me  = botJid

        m.quoted      = isQuoted ? quotedMsg : null
        m.quotedType  = quotedType  || null
        m.isQuoted    = isQuoted

        await react('⏳')

        // ── MODE: => (eval + return, output JSON-formatted) ──
        if (body.startsWith('=>')) {
            const code = body.slice(2).trim()
            try {
                const evaled = await eval(`(async () => { return ${code} })()`)
                const out = evaled === undefined
                    ? 'undefined'
                    : typeof evaled === 'object'
                        ? format(JSON.stringify(evaled, null, 2))
                        : format(evaled)
                await reply(out)
                useLimit()
                await react('✅')
            } catch (err) {
                await react('❌')
                await reply(String(err))
            }

        // ── MODE: > (eval tanpa return, inspect) ──
        } else if (body.startsWith('>')) {
            const code = body.slice(1).trim()
            try {
                let evaled = await eval(code)
                if (evaled === undefined) evaled = 'undefined'
                else if (typeof evaled !== 'string') evaled = inspect(evaled, { depth: 4 })
                await reply(evaled)
                useLimit()
                await react('✅')
            } catch (err) {
                await react('❌')
                await reply(String(err))
            }

        // ── MODE: $ (shell exec) ──
        } else if (body.startsWith('$')) {
            const cmd = body.slice(1).trim()
            if (!cmd) return react('❌')

            _exec(cmd, { timeout: 30000 }, async (err, stdout, stderr) => {
                const out = stdout?.trim() || stderr?.trim()
                if (err && !out) { await react('❌'); return reply(String(err)) }
                useLimit()
                await react('✅')
                if (out) await reply(out)
            })
        }
    }
}
