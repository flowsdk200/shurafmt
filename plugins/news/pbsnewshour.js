import { createManualNewsCommand } from './_manualnews.js'

export default createManualNewsCommand({
    name: 'pbs',
    aliases: ['pbsnews', 'pbsnewshour'],
    description: 'PBS NewsHour',
    sourceUrl: 'https://www.pbs.org/newshour/world',
    linkPattern: /^https?:\/\/(?:www\.)?pbs\.org\/newshour\/world\/(?!page\/|$).+/i,
    maxCandidates: 80,
    selector: 'a[href]'
})
