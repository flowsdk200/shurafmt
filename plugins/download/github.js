import axios from 'axios'

const normalizeGithubUrl = (input = '') => {
    const url = String(input || '').trim()
    if (!url) return { user: '', repo: '' }

    const httpMatch = url.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/(?:[^\s/]+\/)?([^\s/#:]+)\/([^\s/#?]+)(?:\.git)?/i)
    if (httpMatch) {
        const [, user, rawRepo] = httpMatch
        const repo = String(rawRepo || '').replace(/\.git$/i, '').trim()
        return { user, repo }
    }

    const sshMatch = url.match(/^git@github\.com:([^\s/:]+)\/([^\s#?]+)(?:\.git)?$/i)
    if (sshMatch) {
        const [, user, rawRepo] = sshMatch
        const repo = String(rawRepo || '').replace(/\.git$/i, '').trim()
        return { user, repo }
    }

    return { user: '', repo: '' }
}

const getFileNameFromHeader = (disposition = '') => {
    const header = String(disposition || '')

    const quoted = header.match(/filename="([^"]+)"/i)
    if (quoted?.[1]) return quoted[1].trim()

    const unquoted = header.match(/filename=([^;\s]+)/i)
    if (unquoted?.[1]) return unquoted[1].trim()

    return ''
}

export default {
    name: 'git',
    aliases: ['gitclone'],
    description: 'Download archive zip dari repo GitHub',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const q = String(text || '').trim()

        if (!q) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} https://github.com/yemo-dev/biohazard-botz`
            }, { quoted: msg })
        }

        const { user, repo } = normalizeGithubUrl(q)
        if (!user || !repo) {
            return sock.sendMessage(jid, {
                text: '❌ Link tidak valid. pastikan link dari github'
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`

            const head = await axios.head(zipUrl, {
                timeout: 20000,
                maxRedirects: 5,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': 'Mozilla/5.0',
                    Accept: 'application/vnd.github.v3+json'
                }
            })

            if (head.status >= 400) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Repo tidak ditemukan atau tidak bisa diakses.'
                }, { quoted: msg })
            }

            const headerName = getFileNameFromHeader(head.headers?.['content-disposition'])
            const fileName = headerName || `${user}-${repo}.zip`

            await sock.sendMessage(jid, {
                document: { url: zipUrl },
                fileName,
                mimetype: 'application/zip'
            }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            const msgErr = String(err?.response?.status || err?.message || '').toString()

            const fallback = /404/.test(msgErr)
                ? '❌ Repo tidak ditemukan atau aksesnya dibatasi.'
                : `❌ Error: ${err?.message}`

            await sock.sendMessage(jid, {
                text: fallback
            }, { quoted: msg })
        }
    }
}
