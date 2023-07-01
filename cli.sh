xhost +
docker run --gpus all \
           -it \
           --ipc=host \
           --ulimit memlock=-1 \
           --ulimit stack=67108864 \
           --net=host \
           -v /tmp/.X11-unix:/tmp/.X11-unix \
           -e DISPLAY=$DISPLAY \
           katrain:latest 