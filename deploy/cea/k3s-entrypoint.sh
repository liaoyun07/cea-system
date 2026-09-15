#!/bin/sh
set -eu
# CEA's four Dockerized kubelets share a host cgroup namespace. Each must
# manage/garbage-collect only its own Pod subtree, never another cluster's.
node=
for arg in "$@"; do
    case "$arg" in --node-name=*) node=${arg#--node-name=} ;; esac
done
case "$node" in
    cea-cloud|cea-edge-a|cea-edge-b|cea-edge-c) ;;
    *) echo 'CEA K3s requires one of the four configured node names' >&2; exit 2 ;;
esac
test -f /sys/fs/cgroup/cgroup.controllers
mkdir -p "/sys/fs/cgroup/$node"
exec /bin/k3s "$@" "--kubelet-arg=cgroup-root=/$node"
