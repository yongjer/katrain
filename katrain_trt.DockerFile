FROM nvcr.io/nvidia/tensorrt:23.01-py3
ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update && apt-get upgrade -y
RUN apt-get install xclip -y
RUN apt-get install libsdl2-dev -y
RUN apt-get install libzip5 -y
RUN apt-get install libmtdev-dev -y
RUN apt-get install ffmpeg -y
RUN apt-get install unzip -y
RUN pip3 install ffpyplayer
RUN pip3 install katrain
RUN wget https://github.com/lightvector/KataGo/releases/download/v1.13.1/katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
RUN unzip ./katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
RUN mv -f ./katago /
RUN mv -f ./analysis_example.cfg /
RUN wget https://github.com/lightvector/KataGo/releases/download/v1.13.0/b18c384nbt-optimisticv13-s5971M.bin.gz -P /usr/local/lib/python3.8/dist-packages/katrain/models/
RUN rm /usr/local/lib/python3.8/dist-packages/katrain/models/g170e-b15c192-s1672170752-d466197061.bin.gz
RUN rm ./katago-v1.13.1-trt8.5-cuda11.4-linux-x64.zip
CMD [ "katrain" ]