/**
 * APK 内置 Node 运行时 —— JNI 壳（Step 25 延伸）
 *
 * 唯一职责：把 Java 传来的参数数组转成 libuv 需要的**连续内存** argv，调用 node::Start()。
 * 另外顺手把 stdout/stderr 接到 logcat —— 否则设备上 node 的 console.log 全部进 /dev/null，
 * 排障时只能看到"代理没起来"，看不到原因（这一步在真机调试里价值极高）。
 *
 * 对应 Java 侧：com.liferestart.mobile.NodeRuntime.startNodeWithArguments(String[])
 * （JNI 符号名必须与包名/类名/方法名严格对应，改名要同时改这里）
 */

#include <android/log.h>
#include <jni.h>
#include <pthread.h>
#include <unistd.h>

#include <cstdlib>
#include <cstring>
#include <string>

#include "node.h"

// logcat 标签（与 Java 侧 NodeRuntime.TAG 一致，方便过滤）。
#define LOG_TAG "LiferestartNode"

// #logPipeThread
// 读管道 → 写 logcat（Node 的 stdout/stderr 都指向这个管道写端）。
static void* logPipeThread(void* arg) {
  // 管道读端。
  int fd = *reinterpret_cast<int*>(arg);
  // 一行可能很长（比如代理启动横幅），分块读。
  char buffer[1024];
  ssize_t count;
  // 读到 EOF 为止。
  while ((count = read(fd, buffer, sizeof(buffer) - 1)) > 0) {
    buffer[count] = '\0';
    __android_log_write(ANDROID_LOG_INFO, LOG_TAG, buffer);
  }
  return nullptr;
}

// #redirectStdioToLogcat
// 把 stdout/stderr 重定向到 logcat（只做一次）。
static void redirectStdioToLogcat() {
  // 幂等：重复调用会把 stderr 接到别的管道上，反而丢日志。
  static bool redirected = false;
  if (redirected) return;
  redirected = true;
  // 管道：写端交给 stdout/stderr，读端由后台线程搬去 logcat。
  int fds[2];
  if (pipe(fds) != 0) return;
  dup2(fds[1], STDOUT_FILENO);
  dup2(fds[1], STDERR_FILENO);
  // 行缓冲，保证日志及时可见。
  setvbuf(stdout, nullptr, _IOLBF, 0);
  setvbuf(stderr, nullptr, _IOLBF, 0);
  // 管道读端随进程存活（不需要回收线程）。
  static int readFd = fds[0];
  static pthread_t thread;
  pthread_create(&thread, nullptr, logPipeThread, &readFd);
  pthread_detach(thread);
}

extern "C" JNIEXPORT jint JNICALL
Java_com_liferestart_mobile_NodeRuntime_startNodeWithArguments(JNIEnv* env, jclass /* clazz */,
                                                              jobjectArray arguments) {
  // libuv 要求所有参数位于连续内存 → 先算总字节数。
  jsize argumentCount = env->GetArrayLength(arguments);
  int totalSize = 0;
  for (int i = 0; i < argumentCount; i++) {
    jstring arg = reinterpret_cast<jstring>(env->GetObjectArrayElement(arguments, i));
    const char* chars = env->GetStringUTFChars(arg, nullptr);
    totalSize += static_cast<int>(strlen(chars)) + 1;  // +1 给 '\0'
    env->ReleaseStringUTFChars(arg, chars);
    env->DeleteLocalRef(arg);
  }
  // 连续缓冲（calloc 会清零，结尾自然带 '\0'）。
  char* buffer = static_cast<char*>(calloc(totalSize > 0 ? totalSize : 1, sizeof(char)));
  // argv 指针表。
  char** argv = static_cast<char**>(calloc(argumentCount > 0 ? argumentCount : 1, sizeof(char*)));
  // 逐个拷贝到缓冲里，并记录每段的起始位置。
  char* cursor = buffer;
  for (int i = 0; i < argumentCount; i++) {
    jstring arg = reinterpret_cast<jstring>(env->GetObjectArrayElement(arguments, i));
    const char* chars = env->GetStringUTFChars(arg, nullptr);
    strncpy(cursor, chars, strlen(chars));
    argv[i] = cursor;
    cursor += strlen(chars) + 1;
    env->ReleaseStringUTFChars(arg, chars);
    env->DeleteLocalRef(arg);
  }
  // 让 Node 的日志进 logcat。
  redirectStdioToLogcat();
  // 进入 Node（本函数**不会**返回，除非运行时被关闭/出错）。
  int result = node::Start(argumentCount, argv);
  // 清理（正常路径上到不了这里，保留以免将来 node::Start 可返回时泄漏）。
  free(argv);
  free(buffer);
  return static_cast<jint>(result);
}
