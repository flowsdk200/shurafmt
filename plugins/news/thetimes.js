import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'thetimes',
    aliases: ['the-times'],
    description: 'The Times',
    sourceUrl: 'https://www.thetimes.com/world',
    linkPattern: /^https?:\/\/(?:www\.)?thetimes\.com\/world\/.+\/article\/.+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
