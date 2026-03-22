import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'kontan',
    aliases: ['kontannews', 'kontanco'],
    description: 'Kontan News',
    sourceUrl: 'https://www.kontan.co.id/',
    linkPattern: /^https?:\/\/(?:[a-z0-9.-]+\.)?kontan\.co\.id\/(?:[^/?#]+\/)?news\/.+/i,
    maxCandidates: 60,
    selector: 'a[href]'
})
