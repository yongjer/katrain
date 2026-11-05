# KataGo troubleshooting

This page lists common ways in which the provided KataGo fails to work out of the box, and how to resolve these issues.
If you find your problem is not in here, you can ask on the [Computer Go Community Discord](https://discord.gg/AjTPFpN) (use the #gui channel),
 providing detailed information about your error.


* [General](#General)
    * [GPU vs CPU](#CPU)
    * [KataGo model versions](#Models)
* [macOS specific help](#Mac)
* [Windows specific help](#Windows)
* [Linux specific help](#Linux)



## <a name="General"></a> General

###  <a name="CPU"></a> GPU vs CPU

The bundled executables assume you have a compatible graphics card (GPU).
If you don't, KataGo will fail to start in ways that are difficult for KaTrain to pick up.

You can resolve this by downloading a CPU based KataGo version (named 'Eigen' after the library it uses) from
[KataGo's release page](https://github.com/lightvector/KataGo/releases), and setting the KataGo path to it under
*General & Engine Settings* (F8).

Keep in mind that a CPU based engine can be significantly slower, and you may want to set your maximum number of
visits to a lower number to compensate for this.

###  <a name="Models"></a> KataGo model versions

KataGo models have changed over time, and loading a newer model with an older executable can lead to errors.
The transformer models, including the `b10c384h6nbt` model included with KaTrain, require KataGo v1.17.0 or later.
If you have selected an older KataGo binary of your own, either upgrade it or select an older model, such as one of
 the distributed training models available under 'Download Models'.

### Getting more information about errors

*KataGo log* in the main menu shows everything KataGo printed, including the command used to start it.
You can also run that command in a terminal to see KataGo's output directly.

## <a name="Mac"></a><img src="https://upload.wikimedia.org/wikipedia/commons/8/8a/Apple_Logo.svg" alt="macOs" height="35"/> For macOS users

The Apple Silicon app bundles a KataGo built with the Metal backend, which uses the GPU and Neural Engine and
requires macOS 13 or later. The Intel app bundles an OpenCL build.
If the bundled engine does not work on your machine, `brew install katago` and set the engine path to that binary
(e.g. `/opt/homebrew/bin/katago`).

##  <a name="Windows"></a><img src="https://upload.wikimedia.org/wikipedia/commons/5/5f/Windows_logo_-_2012.svg" alt="Windows" height="35"/> For Windows users

The bundled KataGo uses OpenCL. If it fails with a missing DLL, install the latest
[Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist).

## <a name="Linux"></a><img src="https://upload.wikimedia.org/wikipedia/commons/a/ab/Linux_Logo_in_Linux_Libertine_Font.svg" alt="Linux" height="35"/> For Linux users

### libzip compatibility

The most common KataGo issue relates to incompatible library versions, leading to an "Error 127".
A good alternative is to go [here](https://github.com/lightvector/KataGo) and compile KataGo yourself,
or to install it from your distribution, and set the KataGo path to it.
