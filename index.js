#!/usr/bin/env node
const term = require( 'terminal-kit' ).terminal;
const { download } = require('fetch-video');
const prettyBytes = require('pretty-bytes');
const percentile = require('stats-percentile');

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
  segmentSpeeds: [],
  segmentTimes: [],
  segmentSizes: [],
  speedPercentiles: {},
  timePercentiles: {},
  sizePercentiles: {},
  lastSegment: {
    time: 0,
    size: 0,
    speed: 0,
  }
};
const {
  segmentSizes, segmentSpeeds, segmentTimes, speedPercentiles, sizePercentiles, timePercentiles, lastSegment
} = hlsStats;
const { argv: [, , url, refreshPeriod] } = process;
const isLive = !!refreshPeriod;
const refreshPeriodTime = parseInt((refreshPeriod || '0'), 10);
let totalSegments = 0;
let totalTransferred = 0;
let totalSpeed = 0;
const startTime = currentTime();
let totalTime = 0;
let totalDownloadTime = 0;
const showStats = ({ speed, progress, transferred, segments, progressBar }) => {
  const { time, speed: segmentSpeed, size } = lastSegment;
  if (progressBar) progressBar.update(progress / 100);
  term
    .previousLine(1).column(1).eraseLine()
    .yellow(`Speed: `).white(prettyBytes(isLive ? totalSpeed : speed))
    .forwardTab()
    .green(`Segments: `).white(`${isLive ? totalSegments : segments.transferred}`).green('/').gray(`${isLive ? '-' : segments.length}`)
    .forwardTab()
    .blue('Transferred: ').gray(prettyBytes(isLive ? totalTransferred : transferred))
    .forwardTab()
    .cyan('Total time: ').gray(Math.floor(totalTime))
    .previousLine(10).column(1).eraseLine()
    .brightCyan(isLive ? '(LIVE!) ' : '').green('Last segment stats')
    .nextLine().column(1).eraseLine()
    .brightWhite('time:').forwardTab().defaultColor(`${time.toFixed(3)}, `)
    .brightWhite('speed:').forwardTab().defaultColor(`${prettyBytes(segmentSpeed)}, `)
    .brightWhite('size:').forwardTab().defaultColor(prettyBytes(size))
    .nextLine().column(1).eraseLine()
    .green('Speed').forwardTab(3).green('Time').forwardTab(3).green('Size');
  FULL_PERCENTILES.forEach(percents => term
    .nextLine().column(1).eraseLine()
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]](prettyBytes(speedPercentiles[`_${percents}`] || 0)).forwardTab(2)
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]]((timePercentiles[`_${percents}`] || 0).toFixed(3)).forwardTab(2)
    .white(`${percents}%`).forwardTab()[PERCENTS_COLORS[percents]](prettyBytes(sizePercentiles[`_${percents}`] || 0)));
  term.nextLine(2);
};
const start = (url) => {
  const downloader = download(url);
  const progressBar = isLive ? null : term.progressBar({
    title: 'Download progress',
    percent: true,
    eta: true,
    width: 60,
  });
  downloader.on('lastSegmentStats', (lastSegmentStats) => {
    Object.assign(lastSegment, lastSegmentStats);
    const { time, speed, size } = lastSegment;
    if (isLive) {
      totalSegments++;
      totalTransferred += size;
      totalDownloadTime += time;
      totalSpeed = Math.round(totalTransferred / totalDownloadTime);
    }
    const targets = [segmentTimes, segmentSpeeds, segmentSizes];
    const percentiles = [timePercentiles, speedPercentiles, sizePercentiles];
    const sources = [time, speed, size];
    sources.forEach((source, i) => {
      const target = targets[i];
      target.push(source);
      Object.assign(percentiles[i], FULL_PERCENTILES.reduce(getPercentileReducer(target), {}));
    });
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
    .catch(e => console.log(e));
};
term.defaultColor("\n\n\n\n\n\n\n\n\n\n\n");
showStats({ speed: 0, progress: 0, transferred: 0, segments: { transferred: 0, length: Infinity } });
const showTillNextUpdate = (timeLeft, step = 100) => {
  term.column(1).eraseLine().brightCyan(timeLeft > 0 ?
    `Next chunk will be downlaoded in ${(timeLeft / 1000).toFixed(1)} seconds...` :
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
