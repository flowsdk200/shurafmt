import { downloadContentFromMessage } from 'baileys'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { Jimp } = require('jimp')

const streamToBuffer = async (stream) => {
    const chunks = []
    for await (const chunk of stream) chunks.push(chunk)
    return Buffer.concat(chunks)
}

const buildPdfFromJpeg = (jpegBuffer, width, height) => {
    const objects = []

    const addObject = (content) => {
        objects.push(Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'binary'))
    }

    const imageHeader =
        `4 0 obj\n` +
        `<<\n` +
        `/Type /XObject\n` +
        `/Subtype /Image\n` +
        `/Width ${width}\n` +
        `/Height ${height}\n` +
        `/ColorSpace /DeviceRGB\n` +
        `/BitsPerComponent 8\n` +
        `/Filter /DCTDecode\n` +
        `/Length ${jpegBuffer.length}\n` +
        `>>\n` +
        `stream\n`

    const imageFooter = `\nendstream\nendobj\n`
    const contentStream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ`

    addObject(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
    addObject(`2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`)
    addObject(
        `3 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> /ProcSet [/PDF /ImageC] >> ` +
        `/Contents 5 0 R >>\n` +
        `endobj\n`
    )
    addObject(Buffer.concat([
        Buffer.from(imageHeader, 'binary'),
        jpegBuffer,
        Buffer.from(imageFooter, 'binary')
    ]))
    addObject(
        `5 0 obj\n` +
        `<< /Length ${Buffer.byteLength(contentStream, 'binary')} >>\n` +
        `stream\n${contentStream}\nendstream\nendobj\n`
    )

    const header = Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n', 'binary')
    let offset = header.length
    const xref = ['0000000000 65535 f ']
    const body = []

    for (const obj of objects) {
        xref.push(`${String(offset).padStart(10, '0')} 00000 n `)
        body.push(obj)
        offset += obj.length
    }

    const xrefOffset = offset
    const xrefText =
        `xref\n0 ${objects.length + 1}\n` +
        `${xref.join('\n')}\n` +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
        `startxref\n${xrefOffset}\n%%EOF`

    return Buffer.concat([header, ...body, Buffer.from(xrefText, 'binary')])
}

export default {
    name: 'topdf',
    aliases: ['pdf'],
    description: 'Convert gambar ke PDF',
    execute: async ({ sock, msg, isQuoted, quotedMsg, quotedType, react, useLimit, prefix, command }) => {
        const jid = msg.key.remoteJid

        if (!isQuoted || !quotedMsg || quotedType !== 'imageMessage') {
            return sock.sendMessage(jid, {
                text: `❌ Reply gambar dengan caption ${prefix + command}`
            }, { quoted: msg })
        }

        await react('⏳')

        try {
            const stream = await downloadContentFromMessage(quotedMsg.imageMessage, 'image')
            const inputBuffer = await streamToBuffer(stream)
            const image = await Jimp.fromBuffer(inputBuffer)
            const jpegBuffer = await image.getBuffer('image/jpeg')
            const pdfBuffer = buildPdfFromJpeg(jpegBuffer, image.bitmap.width, image.bitmap.height)

            useLimit()
            await sock.sendMessage(jid, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: 'image.pdf'
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
