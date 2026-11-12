#import <Cocoa/Cocoa.h>
#import <unistd.h>

static NSString *gDataDir;
static NSString *gDeploymentId;
static NSTimer *gPollTimer;
static NSMutableDictionary<NSString *, NSTimer *> *gRetentionTimers;
static const NSTimeInterval kRetentionCheckSeconds = 10.0;

static NSString *PathInDataDir(NSString *name) {
    return [gDataDir stringByAppendingPathComponent:name];
}

static void AppendJSONLine(NSString *path, NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    if (data == nil) return;
    NSMutableData *line = [data mutableCopy];
    [line appendBytes:"\n" length:1];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
    if (handle == nil) {
        [[NSFileManager defaultManager] createFileAtPath:path contents:nil attributes:@{NSFilePosixPermissions: @0600}];
        handle = [NSFileHandle fileHandleForWritingAtPath:path];
    }
    if (handle == nil) return;
    @try {
        [handle seekToEndOfFile];
        [handle writeData:line];
        [handle closeFile];
    } @catch (__unused NSException *exception) {
    }
}

static void AppendLog(NSString *message) {
    NSString *line = [message stringByAppendingString:@"\n"];
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:PathInDataDir(@"helper.log")];
    if (handle == nil) {
        [[NSFileManager defaultManager] createFileAtPath:PathInDataDir(@"helper.log")
            contents:nil attributes:@{NSFilePosixPermissions: @0600}];
        handle = [NSFileHandle fileHandleForWritingAtPath:PathInDataDir(@"helper.log")];
    }
    if (handle == nil) return;
    @try {
        [handle seekToEndOfFile];
        [handle writeData:[line dataUsingEncoding:NSUTF8StringEncoding]];
        [handle closeFile];
    } @catch (__unused NSException *exception) {
    }
}

@interface DSHNotificationDelegate : NSObject <NSUserNotificationCenterDelegate>
@end

@implementation DSHNotificationDelegate

- (void)userNotificationCenter:(NSUserNotificationCenter *)center
       didDeliverNotification:(NSUserNotification *)notification {
    AppendLog([NSString stringWithFormat:@"delivered %@", notification.identifier ?: @""]);
}

- (void)userNotificationCenter:(NSUserNotificationCenter *)center
       didActivateNotification:(NSUserNotification *)notification {
    NSInteger activation = notification.activationType;
    if (activation != NSUserNotificationActivationTypeActionButtonClicked
        && activation != NSUserNotificationActivationTypeContentsClicked
        && activation != NSUserNotificationActivationTypeAdditionalActionClicked) {
        return;
    }
    NSString *kind = @"open";
    NSDictionary *action = @{
        @"protocolVersion": @1,
        @"deploymentId": gDeploymentId ?: @"",
        @"notificationId": notification.identifier ?: @"",
        @"kind": kind,
        @"at": @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
    };
    NSString *identifier = notification.identifier ?: @"";
    NSTimer *pending = gRetentionTimers[identifier];
    [pending invalidate];
    [gRetentionTimers removeObjectForKey:identifier];
    AppendJSONLine(PathInDataDir(@"helper-actions.ndjson"), action);
    AppendLog([NSString stringWithFormat:@"action %@ %@", kind, identifier]);
    [center removeDeliveredNotification:notification];
}

@end

static NSString *Option(NSArray<NSString *> *args, NSString *name) {
    NSUInteger index = [args indexOfObject:name];
    if (index == NSNotFound || index + 1 >= args.count) return nil;
    return args[index + 1];
}

static void PostNotification(NSDictionary *request) {
    NSString *identifier = request[@"notificationId"];
    if (![identifier isKindOfClass:[NSString class]] || identifier.length == 0) return;
    NSUserNotification *notification = [NSUserNotification new];
    notification.identifier = identifier;
    notification.title = request[@"title"] ?: @"DeepSeek Harness";
    notification.subtitle = request[@"subtitle"] ?: @"";
    notification.informativeText = request[@"body"] ?: @"";
    notification.hasActionButton = YES;
    notification.actionButtonTitle = @"打开会话";
    NSString *sound = request[@"sound"];
    if ([sound isKindOfClass:[NSString class]] && sound.length > 0) notification.soundName = sound;
    notification.userInfo = @{
        @"deploymentId": gDeploymentId ?: @"",
        @"notificationId": identifier,
    };
    NSUserNotificationCenter *center = [NSUserNotificationCenter defaultUserNotificationCenter];
    [center deliverNotification:notification];
    NSTimer *timer = [NSTimer scheduledTimerWithTimeInterval:kRetentionCheckSeconds
        repeats:NO
        block:^(__unused NSTimer *fired) {
            if (gRetentionTimers[identifier] != fired) return;
            [gRetentionTimers removeObjectForKey:identifier];
            BOOL retained = NO;
            for (NSUserNotification *candidate in center.deliveredNotifications) {
                if (![candidate.identifier isEqualToString:identifier]) continue;
                retained = YES;
                break;
            }
            AppendLog([NSString stringWithFormat:retained ? @"retained %@" : @"not-in-center %@", identifier]);
        }];
    gRetentionTimers[identifier] = timer;
}

static void PollRequests(void) {
    NSFileManager *manager = [NSFileManager defaultManager];
    NSString *requestsDir = PathInDataDir(@"helper-requests");
    NSArray<NSString *> *files = [manager contentsOfDirectoryAtPath:requestsDir error:nil];
    for (NSString *file in [files sortedArrayUsingSelector:@selector(compare:)]) {
        if (![file.pathExtension isEqualToString:@"json"]) continue;
        NSString *path = [requestsDir stringByAppendingPathComponent:file];
        NSData *data = [NSData dataWithContentsOfFile:path];
        if (data == nil) continue;
        NSDictionary *request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([request isKindOfClass:[NSDictionary class]]) {
            NSString *type = request[@"type"];
            if ([type isEqualToString:@"notify"]) {
                PostNotification(request);
            } else if ([type isEqualToString:@"stop"]) {
                [manager removeItemAtPath:path error:nil];
                for (NSTimer *timer in gRetentionTimers.allValues) [timer invalidate];
                [gRetentionTimers removeAllObjects];
                [[NSApplication sharedApplication] terminate:nil];
                return;
            }
        }
        [manager removeItemAtPath:path error:nil];
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSArray<NSString *> *args = NSProcessInfo.processInfo.arguments;
        gDataDir = Option(args, @"--data-dir");
        gDeploymentId = Option(args, @"--deployment");
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        if (gDataDir.length == 0) gDataDir = [defaults stringForKey:@"dshTurnNotifierDataDir"];
        if (gDeploymentId.length == 0) gDeploymentId = [defaults stringForKey:@"dshTurnNotifierDeployment"];
        if (gDataDir.length == 0) {
            AppendLog(@"missing data dir");
            return 2;
        }
        [[NSFileManager defaultManager] createDirectoryAtPath:gDataDir
            withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:nil];
        [[NSFileManager defaultManager] createDirectoryAtPath:PathInDataDir(@"helper-requests")
            withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions: @0700} error:nil];
        [defaults setObject:gDataDir forKey:@"dshTurnNotifierDataDir"];
        if (gDeploymentId.length > 0) [defaults setObject:gDeploymentId forKey:@"dshTurnNotifierDeployment"];
        [defaults synchronize];

        gRetentionTimers = [NSMutableDictionary dictionary];
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        DSHNotificationDelegate *delegate = [DSHNotificationDelegate new];
        [NSUserNotificationCenter defaultUserNotificationCenter].delegate = delegate;

        NSDictionary *pid = @{
            @"pid": @(getpid()),
            @"deploymentId": gDeploymentId ?: @"",
            @"startedAt": @((long long)([[NSDate date] timeIntervalSince1970] * 1000)),
        };
        AppendJSONLine(PathInDataDir(@"helper.pid"), pid);
        AppendLog(@"started");

        gPollTimer = [NSTimer scheduledTimerWithTimeInterval:0.4 repeats:YES block:^(__unused NSTimer *timer) {
            PollRequests();
        }];
        [gPollTimer fire];
        [NSApp run];
    }
    return 0;
}
