import test from 'node:test';
import assert from 'node:assert/strict';
let desktop;
try{desktop=await import('../src/desktop/launch.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const account={name:'fish',uid:1000,home:'/home/fish'};
const config={enabled:true,user:'fish',binary:'/home/fish/bin/computer-use-linux'};
const env={DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0',XDG_RUNTIME_DIR:'/run/user/1000',DBUS_SESSION_BUS_ADDRESS:'unix:path=/run/user/1000/bus',XDG_CURRENT_DESKTOP:'ubuntu:GNOME',XAUTHORITY:'/run/user/1000/.mutter-Xwaylandauth.test',API_KEY:'secret',CHOPSTICKS_CONFIG:'/private/config.json',LD_PRELOAD:'/bad.so',COMPUTER_USE_LINUX_ENABLE_SHELL:'1'};
function build(overrides: Record<string, any>={}){assert.ok(desktop,'desktop launcher is missing');return desktop.buildLaunch(config,{account,desktopEnv:env,callerUid:0,...overrides});}
test('real desktop MCP runs as the logged-in user without the service credentials',()=>{
 const launch=build();assert.equal(launch.command,'/usr/sbin/runuser');assert.deepEqual(launch.args.slice(0,5),['-u','fish','--','/usr/bin/env','-i']);
 assert.equal(launch.args.at(-2),config.binary);assert.equal(launch.args.at(-1),'mcp');
 const values=launch.args.join('\n');assert.match(values,/WAYLAND_DISPLAY=wayland-0/);assert.match(values,/DBUS_SESSION_BUS_ADDRESS=unix:path=\/run\/user\/1000\/bus/);
 assert.doesNotMatch(values,/secret|API_KEY|CHOPSTICKS_CONFIG|LD_PRELOAD/);assert.match(values,/COMPUTER_USE_LINUX_ENABLE_SHELL=0/);
 assert.equal(launch.shell,false);
});
test('desktop launch rejects missing sessions and a different runtime user',()=>{
 assert.ok(desktop,'desktop launcher is missing');
 assert.throws(()=>build({desktopEnv:{}}),/desktop session/i);
 assert.throws(()=>build({desktopEnv:{...env,XDG_RUNTIME_DIR:'/run/user/2000'}}),/desktop session/i);
 assert.throws(()=>build({callerUid:2000}),/desktop account/i);
 assert.throws(()=>desktop.buildLaunch({...config,user:'other'},{account,desktopEnv:env,callerUid:0}),/desktop account/i);
});
test('same-user desktop launch needs no privilege switch and retains literal paths',()=>{
 assert.ok(desktop,'desktop launcher is missing');
 const launch=desktop.buildLaunch({...config,binary:'/home/fish/my tools/computer-use-linux'},{account,desktopEnv:env,callerUid:1000});
 assert.equal(launch.command,'/home/fish/my tools/computer-use-linux');assert.deepEqual(launch.args,['mcp']);
 assert.equal(launch.env.HOME,'/home/fish');assert.equal(launch.env.API_KEY,undefined);assert.equal(launch.env.COMPUTER_USE_LINUX_ENABLE_SHELL,'0');
});
test('launcher rejects disabled configuration, relative executable and root desktop account',()=>{
 assert.ok(desktop,'desktop launcher is missing');
 for(const settings of [{...config,enabled:false},{...config,binary:'computer-use-linux'},{...config,binary:'/bin/a\0b'}])assert.throws(()=>desktop.buildLaunch(settings,{account,desktopEnv:env,callerUid:0}));
 assert.throws(()=>build({account:{...account,uid:0}}),/desktop account/i);
});
test('GNOME startup environment discovers only a verified real user Wayland socket',()=>{
 assert.ok(desktop,'desktop launcher is missing');
 const raw={XDG_RUNTIME_DIR:env.XDG_RUNTIME_DIR,DBUS_SESSION_BUS_ADDRESS:env.DBUS_SESSION_BUS_ADDRESS,XDG_CURRENT_DESKTOP:'ubuntu:GNOME'};
 assert.equal(typeof desktop.completeDesktopEnvironment,'function','GNOME startup environment completion is missing');
 const completed=desktop.completeDesktopEnvironment(raw,account,(p)=>p==='/run/user/1000/wayland-0');
 assert.equal(completed.WAYLAND_DISPLAY,'wayland-0');assert.equal(completed.XDG_SESSION_TYPE,'wayland');
 assert.equal(desktop.completeDesktopEnvironment(raw,account,()=>false).WAYLAND_DISPLAY,undefined);
 assert.doesNotThrow(()=>build({desktopEnv:completed}));
});
test('MCP service start tolerates GNOME automatic login becoming ready later',async()=>{
 assert.equal(typeof desktop.waitForDesktopEnvironment,'function','desktop startup wait is missing');
 let attempts=0;
 const found=await desktop.waitForDesktopEnvironment(account,{discover:()=>{if(++attempts<3)throw Error('not logged in');return env;},retryMs:1,timeoutMs:1000});
 assert.equal(found.WAYLAND_DISPLAY,'wayland-0');assert.equal(attempts,3);
 await assert.rejects(desktop.waitForDesktopEnvironment(account,{discover:()=>{throw Error('not logged in');},retryMs:1,timeoutMs:5}),/desktop session/i);
});
test('unattended GNOME screenshots use the verified native screenshot backend without portal prompts',()=>{
 const launch=build({callerUid:1000});
 assert.equal(launch.env.COMPUTER_USE_LINUX_SCREENSHOT_BACKEND,'gnome-screenshot');
});
test('desktop input portal grants can persist across MCP process restarts',()=>{
 assert.equal(build({callerUid:1000}).env.COMPUTER_USE_LINUX_PERSIST_REMOTE_DESKTOP,'1');
});
test('GNOME keyboard input uses the local user daemon instead of waiting for portal consent',()=>{
 const launch=build({callerUid:1000});
 assert.equal(launch.env.COMPUTER_USE_LINUX_FORCE_YDOTOOL_KEYBOARD,'1');
 assert.equal(launch.env.COMPUTER_USE_LINUX_FORCE_YDOTOOL_POINTER,undefined);
 assert.equal(launch.env.YDOTOOL_SOCKET,undefined);
});
