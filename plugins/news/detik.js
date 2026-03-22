import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'detik',
    aliases: ['detiknews', 'detikcom'],
    description: 'Detik News',
    sourceUrl: 'https://news.detik.com/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?detik\.com\/.+\/d-\d+\/.+/i,
    maxCandidates: 40,
    selector: 'a[href]',
})

