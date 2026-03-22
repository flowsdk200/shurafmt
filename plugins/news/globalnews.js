import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'globalnews',
    aliases: ['gn'],
    description: 'Global News',
    feed: 'https://globalnews.ca/world/feed/'
})
