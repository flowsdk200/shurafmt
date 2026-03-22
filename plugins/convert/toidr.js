import { formatIdr, formatUsd, getUsdToIdrRate, parseInputAmount, row } from './_wise.js'

export default {
    name: 'toidr',
    aliases: ['usdtoidr'],
    description: 'Convert USD ke IDR',
    execute: async ({ sock, msg, text, prefix, command, react, useLimit }) => {
        const jid = msg.key.remoteJid
        const amount = parseInputAmount(text)

        if (!Number.isFinite(amount) || amount <= 0) {
            return sock.sendMessage(jid, {
                text: `Contoh penggunaan:\n- ${prefix + command} 10`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const rate = await getUsdToIdrRate()
            const result = amount * rate
            const detail = [
                row('Input', formatUsd(amount)),
                row('Rate', `$1 = ${formatIdr(rate)}`),
                row('Hasil', formatIdr(result)),
                row('Source', 'Wise')
            ].join('\n')

            useLimit()
            await sock.sendMessage(jid, {
                text:
                    `💱 USD TO IDR\n\n` +
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
