// ScreenCaptureKit system-audio capture bridge for Buka Quality Sound.
// Linked on macOS via build.rs. Requires Screen Recording permission.

#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

typedef void (*BukaAudioCallback)(const float *interleaved,
                                  uint32_t frames,
                                  uint32_t channels,
                                  uint32_t sample_rate,
                                  void *userdata);

typedef struct BukaSckHandle {
  SCStream *stream;
  id delegate;
  BukaAudioCallback callback;
  void *userdata;
  atomic_bool running;
} BukaSckHandle;

@interface BukaSckDelegate : NSObject <SCStreamDelegate, SCStreamOutput>
@property(nonatomic, assign) BukaAudioCallback callback;
@property(nonatomic, assign) void *userdata;
@end

@implementation BukaSckDelegate

- (void)stream:(SCStream *)stream
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
                   ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeAudio || self.callback == NULL) {
    return;
  }
  CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sampleBuffer);
  if (!block) {
    return;
  }
  CMFormatDescriptionRef format = CMSampleBufferGetFormatDescription(sampleBuffer);
  if (!format) {
    return;
  }
  const AudioStreamBasicDescription *asbd =
      CMAudioFormatDescriptionGetStreamBasicDescription(format);
  if (!asbd || asbd->mChannelsPerFrame == 0) {
    return;
  }

  size_t length = 0;
  char *data = NULL;
  if (CMBlockBufferGetDataPointer(block, 0, NULL, &length, &data) != kCMBlockBufferNoErr ||
      data == NULL || length == 0) {
    return;
  }

  const uint32_t channels = (uint32_t)asbd->mChannelsPerFrame;
  const uint32_t sampleRate = (uint32_t)asbd->mSampleRate;
  const size_t bytesPerFrame = (size_t)asbd->mBytesPerFrame;
  if (bytesPerFrame == 0) {
    return;
  }
  const uint32_t frames = (uint32_t)(length / bytesPerFrame);
  if (frames == 0) {
    return;
  }

  // Convert to interleaved f32 for the Rust side.
  NSMutableData *converted =
      [NSMutableData dataWithLength:(NSUInteger)(frames * channels * sizeof(float))];
  float *out = (float *)converted.mutableBytes;
  const BOOL isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
  const BOOL isNonInterleaved =
      (asbd->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;

  if (isFloat && !isNonInterleaved && asbd->mBitsPerChannel == 32) {
    memcpy(out, data, frames * channels * sizeof(float));
  } else if (!isFloat && !isNonInterleaved && asbd->mBitsPerChannel == 16) {
    const int16_t *src = (const int16_t *)data;
    for (uint32_t i = 0; i < frames * channels; i++) {
      out[i] = src[i] / 32768.0f;
    }
  } else if (isFloat && isNonInterleaved && asbd->mBitsPerChannel == 32) {
    const float *base = (const float *)data;
    for (uint32_t f = 0; f < frames; f++) {
      for (uint32_t c = 0; c < channels; c++) {
        out[f * channels + c] = base[c * frames + f];
      }
    }
  } else {
    // Unsupported layout — skip frame rather than corrupt the recording.
    return;
  }

  self.callback(out, frames, channels, sampleRate, self.userdata);
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error {
  (void)stream;
  if (error) {
    NSLog(@"Buka SCK stream stopped: %@", error);
  }
}

@end

static SCShareableContent *BukaGetShareableContent(NSError **outError) {
  __block SCShareableContent *content = nil;
  __block NSError *err = nil;
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  [SCShareableContent
      getShareableContentWithCompletionHandler:^(SCShareableContent *c, NSError *e) {
        content = c;
        err = e;
        dispatch_semaphore_signal(sem);
      }];
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
  if (outError) {
    *outError = err;
  }
  return content;
}

static SCContentFilter *BukaMakeFilter(SCShareableContent *content,
                                       const char *app_filter_utf8,
                                       NSError **outError) {
  if (content.displays.count == 0) {
    if (outError) {
      *outError = [NSError
          errorWithDomain:@"BukaSCK"
                     code:1
                 userInfo:@{
                   NSLocalizedDescriptionKey : @"No displays available for ScreenCaptureKit"
                 }];
    }
    return nil;
  }
  SCDisplay *display = content.displays.firstObject;

  if (app_filter_utf8 == NULL || app_filter_utf8[0] == '\0' ||
      strcmp(app_filter_utf8, "system") == 0) {
    // Display filter with empty excluding lists → full system audio for that display.
    return [[SCContentFilter alloc] initWithDisplay:display
                                   excludingApplications:@[]
                                        excludingWindows:@[]];
  }

  NSString *wanted = [NSString stringWithUTF8String:app_filter_utf8];
  NSMutableArray<SCRunningApplication *> *apps = [NSMutableArray array];
  for (SCRunningApplication *app in content.applications) {
    NSString *bundle = app.bundleIdentifier ?: @"";
    NSString *name = app.applicationName ?: @"";
    NSString *pidStr = [NSString stringWithFormat:@"pid:%d", app.processID];
    NSString *pidBare = [NSString stringWithFormat:@"%d", app.processID];
    if ([bundle isEqualToString:wanted] || [name isEqualToString:wanted] ||
        [pidStr isEqualToString:wanted] || [pidBare isEqualToString:wanted]) {
      [apps addObject:app];
    }
  }
  if (apps.count == 0) {
    if (outError) {
      *outError = [NSError
          errorWithDomain:@"BukaSCK"
                     code:2
                 userInfo:@{
                   NSLocalizedDescriptionKey : [NSString
                       stringWithFormat:@"No running app matched filter '%@'", wanted]
                 }];
    }
    return nil;
  }
  return [[SCContentFilter alloc] initWithDisplay:display
                             includingApplications:apps
                                  exceptingWindows:@[]];
}

// Returns 0 on success. On failure writes a short message into err_buf.
int buka_sck_start(const char *app_filter_utf8,
                   uint32_t sample_rate,
                   BukaAudioCallback callback,
                   void *userdata,
                   void **out_handle,
                   char *err_buf,
                   size_t err_buf_len) {
  if (out_handle == NULL || callback == NULL) {
    return -1;
  }
  @autoreleasepool {
    NSError *error = nil;
    SCShareableContent *content = BukaGetShareableContent(&error);
    if (!content) {
      snprintf(err_buf, err_buf_len,
               "ScreenCaptureKit content unavailable (grant Screen Recording): %s",
               error.localizedDescription.UTF8String ?: "unknown");
      return -2;
    }

    SCContentFilter *filter = BukaMakeFilter(content, app_filter_utf8, &error);
    if (!filter) {
      snprintf(err_buf, err_buf_len, "%s",
               error.localizedDescription.UTF8String ?: "failed to build SCK filter");
      return -3;
    }

    SCStreamConfiguration *config = [[SCStreamConfiguration alloc] init];
    config.capturesAudio = YES;
    if (@available(macOS 13.0, *)) {
      // Explicitly exclude microphone — system/loopback only.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wpartial-availability"
      if ([config respondsToSelector:@selector(setCaptureMicrophone:)]) {
        [config setValue:@(NO) forKey:@"captureMicrophone"];
      }
#pragma clang diagnostic pop
    }
    config.sampleRate = sample_rate > 0 ? sample_rate : 48000;
    config.channelCount = 2;
    // Minimal video dimensions; we only consume audio samples.
    config.width = 2;
    config.height = 2;
    config.minimumFrameInterval = CMTimeMake(1, 1);
    config.showsCursor = NO;

    BukaSckDelegate *delegate = [[BukaSckDelegate alloc] init];
    delegate.callback = callback;
    delegate.userdata = userdata;

    SCStream *stream = [[SCStream alloc] initWithFilter:filter
                                          configuration:config
                                               delegate:delegate];
    BOOL added = [stream addStreamOutput:delegate
                                    type:SCStreamOutputTypeAudio
                      sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0)
                                   error:&error];
    if (!added) {
      snprintf(err_buf, err_buf_len, "addStreamOutput(audio) failed: %s",
               error.localizedDescription.UTF8String ?: "unknown");
      return -4;
    }

    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block NSError *startErr = nil;
    [stream startCaptureWithCompletionHandler:^(NSError *e) {
      startErr = e;
      dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    if (startErr) {
      snprintf(err_buf, err_buf_len,
               "startCapture failed (Screen Recording permission?): %s",
               startErr.localizedDescription.UTF8String ?: "unknown");
      return -5;
    }

    BukaSckHandle *handle = calloc(1, sizeof(BukaSckHandle));
    handle->stream = stream;
    handle->delegate = delegate;
    handle->callback = callback;
    handle->userdata = userdata;
    atomic_store(&handle->running, true);
    // Retain ObjC objects for the handle lifetime.
    CFRetain((__bridge CFTypeRef)stream);
    CFRetain((__bridge CFTypeRef)delegate);
    *out_handle = handle;
    return 0;
  }
}

void buka_sck_stop(void *handle_ptr) {
  if (handle_ptr == NULL) {
    return;
  }
  BukaSckHandle *handle = (BukaSckHandle *)handle_ptr;
  if (!atomic_exchange(&handle->running, false)) {
    free(handle);
    return;
  }
  @autoreleasepool {
    SCStream *stream = handle->stream;
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    [stream stopCaptureWithCompletionHandler:^(NSError *error) {
      (void)error;
      dispatch_semaphore_signal(sem);
    }];
    dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);
    CFRelease((__bridge CFTypeRef)stream);
    CFRelease((__bridge CFTypeRef)handle->delegate);
  }
  free(handle);
}

// Fills ids/names parallel arrays. Returns count written (may be < max_items).
int buka_sck_list_apps(char **ids_out,
                       char **names_out,
                       int max_items,
                       char *err_buf,
                       size_t err_buf_len) {
  if (ids_out == NULL || names_out == NULL || max_items <= 0) {
    return -1;
  }
  @autoreleasepool {
    NSError *error = nil;
    SCShareableContent *content = BukaGetShareableContent(&error);
    if (!content) {
      snprintf(err_buf, err_buf_len, "SCK list apps failed: %s",
               error.localizedDescription.UTF8String ?: "unknown");
      return -2;
    }
    int n = 0;
    for (SCRunningApplication *app in content.applications) {
      if (n >= max_items) {
        break;
      }
      if (app.bundleIdentifier.length == 0 && app.applicationName.length == 0) {
        continue;
      }
      NSString *idStr = [NSString stringWithFormat:@"pid:%d", app.processID];
      NSString *name = app.applicationName.length
                           ? app.applicationName
                           : (app.bundleIdentifier ?: idStr);
      ids_out[n] = strdup(idStr.UTF8String);
      names_out[n] = strdup(name.UTF8String);
      n++;
    }
    return n;
  }
}

void buka_sck_free_cstr(char *s) {
  if (s) {
    free(s);
  }
}
