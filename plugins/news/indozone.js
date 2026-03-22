import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'indozone',
    aliases: ['indoz'],
    description: 'IndoZone News',
    sourceUrl: 'https://news.indozone.id/',
    linkPattern: /^https?:\/\/(?:www\.)?news\.indozone\.id\/[a-z0-9-]+\/\d+\/[a-z0-9-]+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
