import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'nbcnews',
    aliases: ['nbc', 'worldnews'],
    description: 'NBC News',
    sourceUrl: 'https://www.nbcnews.com/world',
    linkPattern: /^https?:\/\/(?:www\.)?nbcnews\.com\/world\/.+-rcna\d+/i,
    maxCandidates: 60,
    selector: 'a[href]'
})
