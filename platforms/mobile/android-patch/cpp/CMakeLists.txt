# APK 内置 Node 运行时 —— JNI 壳的 CMake 配置（Step 25 延伸）
#
# 官方 toolkit（nodejs-mobile v18.20.4）只提供头文件 + 预编译 libnode.so，
# 启动入口 node::Start(argc, argv) 是 C++ API，所以必须自己编译一个极小的 JNI 壳：
#
#   Java: com.liferestart.mobile.NodeRuntime.startNodeWithArguments(String[])
#     ↓ JNI
#   C++ : node::Start(argc, argv)   ← 在 NodeRuntime.java 起的独立线程里执行
#
# 目录约定（都由 scripts/prepare-android.js 摆放；android/ 不入库，CI 每次现场生成）：
#   app/libnode/include/node/node.h          ← 官方 zip 的 include/
#   app/libnode/bin/${ANDROID_ABI}/libnode.so ← 官方 zip 的 bin/
#   app/src/main/cpp/{CMakeLists.txt,nodejs_jni.cpp}

# CMake 3.22+（GitHub runner 与 Android SDK 默认都满足）。
cmake_minimum_required(VERSION 3.22.1)

project(nodejs_jni CXX)

# libnode 的头文件（app/libnode/include/node/node.h）。
include_directories(${CMAKE_SOURCE_DIR}/../../../libnode/include/node)

# JNI 壳 → libnodejs_jni.so。
add_library(nodejs_jni SHARED nodejs_jni.cpp)

# 预编译的 libnode.so（按 ABI 选择；abiFilters 已在 nodejs.gradle 里限定为下面三个）。
add_library(libnode SHARED IMPORTED)
set_target_properties(
        libnode
        PROPERTIES IMPORTED_LOCATION
        ${CMAKE_SOURCE_DIR}/../../../libnode/bin/${ANDROID_ABI}/libnode.so)

# libnode 用 libC++ 共享库构建（gradle 里传了 -DANDROID_STL=c++_shared）；
# log 用于把 Node 的 stdout/stderr 转发到 logcat。
find_library(log-lib log)
target_link_libraries(nodejs_jni libnode ${log-lib})
