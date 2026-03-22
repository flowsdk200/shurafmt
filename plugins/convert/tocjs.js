import { ZAi } from '../../scrape/zai.js'

const zai = new ZAi()

const SYSTEM_PROMPT = `Lu adalah konverter kode JavaScript ESModule (ESM) ke CommonJS (CJS) yang ahli dan presisi.

TUGAS:
- Konversi kode ESM yang diberikan user menjadi CommonJS (CJS) yang valid dan bersih.

ATURAN KONVERSI:
- import x from 'x' → const x = require('x')
- import { a, b } from 'x' → const { a, b } = require('x')
- import * as x from 'x' → const x = require('x')
- import x, { a } from 'x' → const x = require('x'); const { a } = x
- export default x → module.exports = x
- export const x = y → const x = y; exports.x = x (atau module.exports.x jika satu-satunya export)
- export { a, b } → exports.a = a; exports.b = b
- export { a as default } → module.exports = a
- import() dinamis → require() (sync) jika memungkinkan, atau tetap import() jika async context
- import.meta.url → __filename (dengan catatan)
- import.meta.env → process.env
- Hapus .js extension di require() lokal jika tidak diperlukan (CJS resolve otomatis)
- top-level await → bungkus dalam async IIFE: (async () => { ... })()

PENANGANAN SNIPPET:
- Jika kode tidak punya require/module.exports/import/export (snippet biasa seperti switch, function, class), tetap proses — rewrite agar kompatibel gaya CJS (misalnya hilangkan top-level await, pastikan sync-friendly) dan kembalikan kode yang bersih
- Jangan tolak snippet hanya karena tidak ada module syntax

OUTPUT:
- Langsung tulis kode hasil konversi tanpa penjelasan panjang
- Tambahkan komentar singkat di atas jika ada hal penting yang perlu diperhatikan
- Jika kode sudah CJS sempurna, balas: "Kode ini sudah CJS, tidak perlu dikonversi."
- Jika input bukan kode JavaScript sama sekali, balas: "Input bukan kode JavaScript yang valid."
- Dilarang markdown seperti \`\`\`javascript atau fence block — output kode mentah saja`

export default {
    name: 'tocjs',
    aliases: ['esm2cjs', 'cjs'],
    description: 'Konversi kode ESModule ke CommonJS menggunakan AI',
    execute: async ({ sock, msg, text, isQuoted, quotedMsg, quotedType, react, useLimit }) => {
        const jid = msg.key.remoteJid

        // Ambil kode dari teks langsung atau dari quoted message
        let code = text?.trim()
        if (!code && isQuoted && quotedMsg) {
            if (quotedType === 'conversation') code = quotedMsg.conversation?.trim()
            else if (quotedType === 'extendedTextMessage') code = quotedMsg.extendedTextMessage?.text?.trim()
        }

        if (!code) {
            return sock.sendMessage(jid, {
                text: `❌ Kirim/reply kode ESM yang ingin dikonversi.`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const result = await zai.chat({
                model: 'glm-5',
                stream: false,
                max_tokens: 25000,
                temperature: 0.2,
                top_p: 0.9,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: code }
                ]
            })

            const reply = result?.choices?.[0]?.message?.content?.trim()
            if (!reply) {
                await react('❌')
                return sock.sendMessage(jid, { text: '❌ AI tidak memberikan respons. coba lagi nanti.' }, { quoted: msg })
            }

            useLimit()
            await react('✅')
            await sock.sendMessage(jid, { text: reply }, { quoted: msg })
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg })
        }
    }
}
