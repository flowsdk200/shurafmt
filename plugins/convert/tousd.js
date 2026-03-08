import { formatIdr, formatUsd, formatUsdRate, getIdrToUsdRate, parseInputAmount, row } from './_wise.js'

export default {
    name: 'tousd',
    aliases: ['idrtousd'],
    description: 'Convert IDR ke USD',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const amount = parseInputAmount(text)

        if (!Number.isFinite(amount) || amount <= 0) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} 100000`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const rate = await getIdrToUsdRate()
            const result = amount * rate
            const detail = [
                row('Input', formatIdr(amount)),
                row('Rate', `${formatIdr(1)} = ${formatUsdRate(rate)}`),
                row('Hasil', formatUsd(result)),
                row('Source', 'Wise')
            ].join('\n')

            useLimit()
            await sock.sendMessage(jid, {
                text:
                    `💱 IDR TO USD\n\n` +
                    `  \`KONVERSI:\`\n` +
                    `\`\`\`${detail}\`\`\``
            }, { quoted: msg })
            await react('✅')
        } catch (err) {
            await react('❌')
            await sock.sendMessage(jid, {
                text: `❌ Error: ${err.message}`
            }, { quoted: msg })
        }
    }
}
