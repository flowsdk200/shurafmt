import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'bola',
    aliases: ['bolacom'],
    description: 'Bola.com News',
    sourceUrl: 'https://www.bola.com',
    linkPattern: /^https?:\/\/(?:www\.)?bola\.com\/(?:[a-z0-9-]+)\/read\/\d+\/[a-z0-9-]+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
