import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'cna',
    aliases: ['cna-id'],
    description: 'CNA Indonesia',
    sourceUrl: 'https://www.cna.id/indonesia',
    linkPattern: /^https?:\/\/(?:www\.)?cna\.id\/indonesia\/[a-z0-9-]+-\d+$/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
