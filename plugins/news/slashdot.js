import { createRssCommand } from './_rssbase.js'

export default createRssCommand({
    name: 'slashdot',
    description: 'Slashdot',
    feed: 'http://rss.slashdot.org/Slashdot/slashdot',
})
