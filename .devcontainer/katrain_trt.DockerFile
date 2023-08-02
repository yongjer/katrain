FROM nvcr.io/nvidia/tensorrt:23.01-py3
ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update && apt-get upgrade -y
RUN apt-get install xclip -y
RUN apt-get install libsdl2-dev -y
RUN apt-get install libzip5 -y
RUN apt-get install libmtdev-dev -y
RUN apt-get install ffmpeg -y
RUN apt-get install unzip -y
RUN pip3 install -U ffpyplayer
RUN pip3 install -U katrain
RUN wget https://github.com/lightvector/KataGo/releases/download/v1.13.1/katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
RUN unzip ./katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
RUN mv -f ./katago /
RUN rm ./katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
CMD [ "katrain" ]