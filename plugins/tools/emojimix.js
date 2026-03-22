import axios from 'axios'
import fs from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

const runFfmpeg = (args) => new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args, { stdio: 'pipe' })
    ff.on('error', reject)
    ff.on('close', (code) => {
        if (code !== 0) reject(new Error(`FFmpeg exited with code ${code}`))
        else resolve()
    })
})

const getCodepoint = (emoji) => Array.from(emoji)
    .map((char) => char.codePointAt(0).toString(16))
    .join('-')

export default {
    name: 'emojimix',
    aliases: ['emix'],
    description: 'Mix 2 emoji jadi sticker',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const raw = String(text || '').trim()

        if (!raw) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} 😂+🤔\n- ${prefix + command} 😭+🤣`
            }, { quoted: msg })
        }

        const args = raw.split('+').map((x) => x.trim())
        if (args.length < 2 || !args[0] || !args[1]) {
            return sock.sendMessage(jid, {
                text: `❌ Masukkan 2 emoji dengan pemisah +\nContoh: ${prefix + command} 😂+🤔`
            }, { quoted: msg })
        }

        const [emoji1, emoji2] = args
        const emojiRegex = /\p{Emoji}/u
        if (!emojiRegex.test(emoji1) || !emojiRegex.test(emoji2)) {
            return sock.sendMessage(jid, {
                text: '❌ Input harus berupa emoji! contoh: 😂+🤔'
            }, { quoted: msg })
        }

        await react('🎨')

        const tempDir = path.join(tmpdir(), 'emojimix')
        const stamp = `${Date.now()}-${Math.floor(Math.random() * 9999)}`
        const tempFile = path.join(tempDir, `emojimix_${stamp}.png`)
        const outFile = path.join(tempDir, `emojimix_${stamp}.webp`)

        try {
            const code1 = getCodepoint(emoji1)
            const code2 = getCodepoint(emoji2)
            const url = `https://emojik.vercel.app/s/${code1}_${code2}?size=512`

            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                validateStatus: () => true
            })

            if (response.status === 404) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Kombinasi emoji tidak ditemukan. coba emoji lain!'
                }, { quoted: msg })
            }

            if (!response.data || response.data.length < 100) {
                await react('❌')
                return sock.sendMessage(jid, {
                    text: '❌ Kombinasi emoji tidak tersedia. coba kombinasi lain!'
                }, { quoted: msg })
            }

            await fs.mkdir(tempDir, { recursive: true })
            await fs.writeFile(tempFile, Buffer.from(response.data))

            await runFfmpeg([
                '-y',
                '-i', tempFile,
                '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:-1:-1:color=0x00000000',
                '-c:v', 'libwebp',
                '-quality', '90',
                '-preset', 'picture',
                '-loop', '0',
                outFile
            ])

            const webpBuffer = await fs.readFile(outFile)
            await sock.sendMessage(jid, { sticker: webpBuffer }, { quoted: msg })

            useLimit()
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        } finally {
            await fs.unlink(tempFile).catch(() => {})
            await fs.unlink(outFile).catch(() => {})
        }
    }
}
