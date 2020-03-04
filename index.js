#!/usr/bin/env node
const term = require( 'terminal-kit' ).terminal;
const { download } = require('fetch-video');
const prettyBytes = require('pretty-bytes');
const Stats = require('fast-stats').Stats;

const currentTime = () => ((new Date()).getTime() / 1000);
const FULL_PERCENTILES = [1, 5, 10, 50, 90, 95, 99];
const PERCENTS_COLORS = {
  1: 'brightWhite',
  5: 'white',
  10: 'white',
  50: 'brightYellow',
  90: 'white',
  95: 'white',
  99: 'brightWhite',
};
const getPercentileReducer = (data) => (acc, percents) => Object.assign(acc, {
  [`_${percents}`]: percentile(data, percents)
});
function echoLine(line, text, color = 'defaultColor') {
  term
    .nextLine(line)
    .eraseLine()
    .column(1)
    [color](text)
    .previousLine(line)
}
const hlsStats = {
  speedStats: new Stats(),
  timeStats: new Stats(),
  sizeStats: new Stats(),
  segmentWaitStats: new Stats(),
  playlistsLoadStats: new Stats(),
  lastSegment: {
    time: 0,
    size: 0,
    speed: 0,
  }
};
const {
  lastSegment, playlistsLoadStats, segmentWaitStats, sizeStats, speedStats, timeStats,
} = hlsStats;
const { argv: [, , url, refreshPeriod] } = process;
const isLive = !!refreshPeriod;
const refreshPeriodTime = parseInt((refreshPeriod || '0'), 10);
const startTime = currentTime();
let totalSegments = 0;
let totalTime = 0;
let totalErrors = 0;
const showStats = ({ speed, progress, transferred, segments, progressBar }) => {
  const { time, speed: segmentSpeed, size } = lastSegment;
  if (progressBar) progressBar.update(progress / 100);
  term
    .previousLine(1).column(1).eraseLine()
    .brightWhite('Total').forwardTab().brightWhite('| ')
    .green(`Segments: `).white(`${isLive ? totalSegments : segments.transferred}`).green('/').gray(`${isLive ? '-' : segments.length}`)
    .forwardTab()
    .blue('Transferred: ').gray(prettyBytes(isLive ? sizeStats.sum : transferred))
    .forwardTab()
    .cyan('Test time: ').gray(Math.floor(totalTime))
    .forwardTab()
    .red('Errors: ').white(totalErrors.toString())
    .previousLine(1).column(1).eraseLine()
    .brightWhite('Average').forwardTab().brightWhite('| ')
    .yellow(`Speed: `).white(prettyBytes(Math.round(speedStats.amean() || 0)))
    .forwardTab()
    .gray('Playlists time: ').white(playlistsLoadStats.amean().toFixed(3))
    .forwardTab()
    .magenta('Response time: ').white(segmentWaitStats.amean().toFixed(3))
    .forwardTab()
    .cyan('Segment download time: ').white(timeStats.amean().toFixed(3))
    .previousLine(3 + FULL_PERCENTILES.length).column(1).eraseLine()
    .brightCyan(isLive ? '(LIVE!) ' : '').green('Last segment stats')
    .nextLine().column(1).eraseLine()
    .brightWhite('time:').forwardTab().defaultColor(`${time.toFixed(3)}, `)
    .brightWhite('speed:').forwardTab().defaultColor(`${prettyBytes(segmentSpeed)}, `)
    .brightWhite('size:').forwardTab().defaultColor(prettyBytes(size))
    .nextLine().column(1).eraseLine()
    .green('Speed').forwardTab(3).green('Playlists time').forwardTab(2).green('Response time').forwardTab(2).green('Segment download time');
  FULL_PERCENTILES.forEach(percents => term
    .nextLine().column(1).eraseLine()
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]](prettyBytes(speedStats.percentile(percents) || 0)).forwardTab(2)
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]]((playlistsLoadStats.percentile(percents) || 0).toFixed(3)).forwardTab(2)
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]]((segmentWaitStats.percentile(percents) || 0).toFixed(3)).forwardTab(2)
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]]((timeStats.percentile(percents) || 0).toFixed(3)));
  term.nextLine(3);
};
const start = (url) => {
  const downloader = download(url);
  const progressBar = isLive ? null : term.progressBar({
    title: 'Download progress',
    percent: true,
    eta: true,
    width: 60,
  });
  downloader.on('playlistsLoad', ({ time }) => playlistsLoadStats.push(time));
  downloader.on('response', ({ time }) => segmentWaitStats.push(time));
  downloader.on('lastSegmentStats', (lastSegmentStats) => {
    Object.assign(lastSegment, lastSegmentStats);
    const { time, speed, size } = lastSegment;
    if (isLive) totalSegments++;
    const targets = [timeStats, speedStats, sizeStats];
    const sources = [time, speed, size];
    sources.forEach((source, i) => targets[i].push(source));
  });
  downloader.on('stats', (stats) => {
    if (progressBar) Object.assign(stats, { progressBar });
    totalTime = currentTime() - startTime;
    showStats(stats);
  });
  return downloader.go()
    .then(() => {
      if (progressBar) progressBar.update(1);
      if (!isLive) term("\n\n");
    })
    .catch(() => totalErrors++);
};
term.defaultColor("\n\n\n\n\n\n\n\n\n\n\n\n\n");
showStats({ speed: 0, progress: 0, transferred: 0, segments: { transferred: 0, length: Infinity } });
const showTillNextUpdate = (timeLeft, step = 100) => {
  term.column(1).eraseLine().brightCyan(timeLeft > 0 ?
    `Next chunk will be downloaded in ${(timeLeft / 1000).toFixed(1)} seconds...` :
    'Next chunk downloading NOW!'
  );
  if (timeLeft > 0) setTimeout(() => showTillNextUpdate(timeLeft - step), step);
};
const liveWatch = (url, period) => {
  const timeoutPeriod = period * 1000;
  const watchStart = currentTime();
  start(url).then(() => {
    const loadTime = (currentTime() - watchStart) * 1000;
    const diffTime = timeoutPeriod - loadTime;
    const isBuffering = diffTime < 0;
    const correctPeriod = isBuffering ? 0 : diffTime;
    setTimeout(() => liveWatch(url, period), correctPeriod);
    showTillNextUpdate(correctPeriod);
  });
};
if (isLive) liveWatch(url, refreshPeriodTime);
else start(url);
