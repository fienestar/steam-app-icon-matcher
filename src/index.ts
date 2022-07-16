import plist from 'simple-plist';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import SteamUser from 'steam-user';
import https from 'https';

const user = new SteamUser();
user.logOn();

function getInput(message?: string): Promise<string> {
    if (message === undefined) {
        message = '';
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(message as string, (code) => {
            rl.close();
            resolve(code);
        });
    });
}

type PromiseLikeHandler<Error, Result> = (error: Error|null, result: Result|null) => void;
type PromiseLike<Error, Result> = (cb: PromiseLikeHandler<Error, Result>) => void;
function toPromise<Error, Result>(promiseLike: PromiseLike<Error, Result>) {
    return new Promise<Result>((resolve, reject) => promiseLike((err: Error|null, result: Result|null) => {
        if (err !== null || result === null) reject(err);
        else resolve(result);
    }));
}

async function patchAppIconPath(appPath: string, iconPath: string) {
    const plistPath = path.join(appPath, 'Info.plist');
    const data = await toPromise(plist.readFile.bind(plist, plistPath)) as { [key: string]: string};
    data.CFBundleIconFile = iconPath;
    await toPromise(plist.writeFile.bind(plist, plistPath, data, {}));
}

async function getAppId(appPath: string) {
    const shPath = path.join(appPath, 'MacOS', 'run.sh');
    const shBuffer = await toPromise(fs.readFile.bind(fs, shPath));
    const shString = shBuffer.toString();
    const runString = 'steam://run/';
    const appId = shString.substring(shString.indexOf(runString) + runString.length).trim();
    return +appId;
}

async function getIconURI(appId: number) {
    const productInfo = await user.getProductInfo([appId], []);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const icon = productInfo.apps[appId].appinfo.common.clienticon;
    const iconURI = `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appId}/${icon}.ico`;
    return iconURI;
}

async function matchAppIcon(appPath: string) {
    const appId = await getAppId(appPath);
    const iconURI = await getIconURI(appId);
    const fileName = iconURI.split('/').pop() as string;
    console.log(iconURI);
    const resourcePath = path.join(appPath, 'Resources');
    const file = fs.createWriteStream(path.join(resourcePath, fileName));
    await new Promise<void>((resolve) => https.get(iconURI, (response) => {
        response.pipe(file);
        file.on('finish', () => {
            file.close(() => resolve());
        });
    }));
    await patchAppIconPath(appPath, fileName);
    return;
}


async function app() {
    if (process.argv.length < 3) {
        return console.error(`usage: ${process.argv.join(' ')} [path of games]`);
    }

    const dirPath = process.argv[2];
    const dir = await toPromise(fs.readdir.bind(fs, dirPath, {withFileTypes: true}));
    await Promise.all(dir.map(async (element) => {
        if (element.isDirectory()) {
            await matchAppIcon(path.join(dirPath, element.name, 'Contents'));
        }
    }));
}

user.on('loggedOn', () => {
    app()
        .then(() => {
            console.log('done!');
        })
        .catch((error) => {
            console.error(error);
        });
});
