'use strict';
const path = require('path');
const electron = require('electron');
const unusedFilename = require('unused-filename');
const pupa = require('pupa');
const extName = require('ext-name');

const app = electron.app;
const shell = electron.shell;

function getFilenameFromMime(name, mime) {
	const exts = extName.mime(mime);

	if (exts.length !== 1) {
		return name;
	}

	return `${name}.${exts[0].ext}`;
}
const downloadItems = new Set();
let receivedBytes = 0;
let completedBytes = 0;
let totalBytes = 0;

function registerListener(session, opts = {}, cb = () => {}) {
	const activeDownloadItems = () => downloadItems.size;
	const progressDownloadItems = () => receivedBytes / totalBytes;

	const listener = (e, item, webContents) => {
		console.log('append item', item.getURL());
		downloadItems.add(item);
		totalBytes += item.getTotalBytes();

		let hostWebContents = webContents;
		if (webContents.getType() === 'webview') {
			hostWebContents = webContents.hostWebContents;
		}
		const win = electron.BrowserWindow.fromWebContents(hostWebContents);

		const dir = opts.directory || app.getPath('downloads');
		let filePath;
		if (opts.filename) {
			filePath = path.join(dir, opts.filename);
		} else {
			const filename = item.getFilename();
			const name = path.extname(filename) ? filename : getFilenameFromMime(filename, item.getMimeType());

			filePath = unusedFilename.sync(path.join(dir, name));
		}

		const errorMessage = opts.errorMessage || 'The download of {filename} was interrupted';
		const errorTitle = opts.errorTitle || 'Download Error';

		if (!opts.saveAs) {
			item.setSavePath(filePath);
		}

		item.on('updated', () => {
			receivedBytes = [...downloadItems].reduce((receivedBytes, item) => {
				receivedBytes += item.getReceivedBytes();
				return receivedBytes;
			}, completedBytes);

			if (['darwin', 'linux'].includes(process.platform)) {
				app.setBadgeCount(activeDownloadItems());
			}

			if (!win.isDestroyed()) {
				win.setProgressBar(progressDownloadItems());
			}

			if (typeof opts.onProgress === 'function') {
				opts.onProgress(progressDownloadItems());
			}

			if (typeof opts.onItemProgress === 'function') {
				opts.onItemProgress(item.getReceivedBytes() / item.getTotalBytes(), item);
			}
		});

		item.on('done', (e, state) => {
			console.log('done item', item.getURL());
			completedBytes += item.getTotalBytes();
			downloadItems.delete(item);

			if (['darwin', 'linux'].includes(process.platform)) {
				app.setBadgeCount(activeDownloadItems());
			}

			if (!win.isDestroyed() && !activeDownloadItems()) {
				win.setProgressBar(-1);
				receivedBytes = 0;
				completedBytes = 0;
				totalBytes = 0;
			}

			if (state === 'interrupted') {
				const message = pupa(errorMessage, {filename: item.getFilename()});
				electron.dialog.showErrorBox(errorTitle, message);
				console.log('interupted', message);
				cb(new Error(message));
			} else if (state === 'completed') {
				if (process.platform === 'darwin') {
					app.dock.downloadFinished(filePath);
				}

				if (opts.openFolderWhenDone) {
					shell.showItemInFolder(filePath);
				}

				if (opts.unregisterWhenDone) {
					session.removeListener('will-download', listener);
				}
				console.log('complete')
				if (typeof opts.onItemProgress === 'function') {
					opts.onItemProgress(1, item);
				}

				cb(null, item);
			}
		});
	};

	session.on('will-download', listener);
}

module.exports = (opts = {}) => {
	app.on('session-created', session => {
		registerListener(session, opts);
	});
};
let flag = true;
module.exports.download = (win, url, opts) => new Promise((resolve, reject) => {
	opts = Object.assign({}, opts, {unregisterWhenDone: false});
	if (flag) {
		registerListener(win.webContents.session, opts, (err, item) => {
			if (err) {
				reject(err);
			} else {
				resolve(item);
			}
		});
		flag = false;
	}

	win.webContents.downloadURL(url);
});
