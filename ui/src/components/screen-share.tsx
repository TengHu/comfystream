import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Canvas component that handles rendering of screen sharing with selection capabilities
 */
function StreamCanvas({
  stream,
  frameRate,
  onStreamReady,
}: {
  stream: MediaStream | null;
  frameRate: number;
  onStreamReady: (stream: MediaStream) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animationRef = useRef<number>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 1280, height: 720 });
  const outputStreamRef = useRef<MediaStream | null>(null);
  
  // Selection state
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{x: number, y: number} | null>(null);
  const [boundingBox, setBoundingBox] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  const [showFullScreen, setShowFullScreen] = useState(true);

  // Draw state info
  const drawInfo = useRef<{
    offsetX: number;
    offsetY: number;
    drawWidth: number;
    drawHeight: number;
    scaleX: number;
    scaleY: number;
  } | null>(null);

  // Create a consistent MediaStream from canvas
  useEffect(() => {
    if (!canvasRef.current || !stream) return;

    // Clean up previous stream if it exists
    if (outputStreamRef.current) {
      outputStreamRef.current.getTracks().forEach(track => track.stop());
    }

    try {
      // Create a stream from the canvas with fixed resolution
      const canvas = canvasRef.current;
      const outputStream = canvas.captureStream(frameRate || 30);
      
      // Add audio tracks from the original stream if they exist
      stream.getAudioTracks().forEach(track => {
        outputStream.addTrack(track);
      });
      
      // Save reference to the new stream and pass to parent
      outputStreamRef.current = outputStream;
      onStreamReady(outputStream);
      
      console.log("[ScreenShare] Created canvas-based output stream with resolution:", canvas.width, "x", canvas.height);
    } catch (error) {
      console.error("[ScreenShare] Failed to create canvas stream:", error);
    }

    return () => {
      if (outputStreamRef.current) {
        outputStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream, frameRate, onStreamReady]);

  // Convert canvas coordinates to video coordinates
  const canvasToVideoCoords = useCallback((canvasX: number, canvasY: number) => {
    const info = drawInfo.current;
    if (!info || !videoRef.current) return { x: 0, y: 0 };
    
    // Adjust for canvas offset where the video is drawn
    const adjustedX = canvasX - info.offsetX;
    const adjustedY = canvasY - info.offsetY;
    
    // Apply scale to get video coordinates
    return {
      x: adjustedX * info.scaleX,
      y: adjustedY * info.scaleY
    };
  }, []);

  // Handle mouse down to start bounding box selection
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !stream || stream.getVideoTracks().length === 0) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    setIsSelecting(true);
    setSelectionStart({x, y});
    
    // Reset the current bounding box while selecting a new region
    if (showFullScreen) {
      setBoundingBox(null);
    }
  }, [showFullScreen, stream]);

  // Handle mouse move to update bounding box during selection
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !selectionStart || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    // Update bound box in real-time
    setBoundingBox({
      startX: selectionStart.x,
      startY: selectionStart.y,
      endX: x,
      endY: y
    });
  }, [isSelecting, selectionStart]);

  // Handle mouse up to finalize bounding box selection
  const handleMouseUp = useCallback(() => {
    if (isSelecting && boundingBox) {
      // Minimum selection size (10x10 pixels)
      const minSize = 10;
      const width = Math.abs(boundingBox.endX - boundingBox.startX);
      const height = Math.abs(boundingBox.endY - boundingBox.startY);
      
      if (width < minSize || height < minSize) {
        // If selection is too small, ignore it
        if (showFullScreen) {
          setBoundingBox(null);
        }
      } else {
        // Normalize coordinates (ensure startX < endX and startY < endY)
        const normalizedBox = {
          startX: Math.min(boundingBox.startX, boundingBox.endX),
          startY: Math.min(boundingBox.startY, boundingBox.endY),
          endX: Math.max(boundingBox.startX, boundingBox.endX),
          endY: Math.max(boundingBox.startY, boundingBox.endY)
        };
        
        setBoundingBox(normalizedBox);
        setShowFullScreen(false);
      }
    }
    
    setIsSelecting(false);
    setSelectionStart(null);
  }, [isSelecting, boundingBox, showFullScreen]);

  // Reset bounding box and show full screen again
  const resetBoundingBox = useCallback(() => {
    setBoundingBox(null);
    setShowFullScreen(true);
  }, []);

  // Update canvas size on window resize
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        // Fix canvas to 1280x720 resolution (16:9 aspect ratio)
        setCanvasSize({
          width: 1280,
          height: 720
        });
      }
    };

    // Set initial size
    handleResize();
    
    // No need to listen for resize events since we want a fixed canvas size
    return () => {};
  }, []);

  // Draw function for rendering video on canvas
  const drawVideoFrame = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    
    if (!canvas || !ctx || !video || !video.videoWidth) {
      return;
    }

    // Clear canvas
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate scaling to maintain aspect ratio
    const canvasAspect = canvas.width / canvas.height;
    const videoAspect = video.videoWidth / video.videoHeight;
    let drawWidth = canvas.width;
    let drawHeight = canvas.height;
    let offsetX = 0;
    let offsetY = 0;

    if (videoAspect > canvasAspect) {
      // Video is wider than canvas
      drawHeight = canvas.width / videoAspect;
      offsetY = (canvas.height - drawHeight) / 2;
    } else {
      // Video is taller than canvas
      drawWidth = canvas.height * videoAspect;
      offsetX = (canvas.width - drawWidth) / 2;
    }

    // Save drawing information for coordinate conversion
    const scaleX = video.videoWidth / drawWidth;
    const scaleY = video.videoHeight / drawHeight;
    drawInfo.current = { offsetX, offsetY, drawWidth, drawHeight, scaleX, scaleY };

    if (showFullScreen || !boundingBox) {
      // Draw the full video frame
      ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
    } else {
      // Draw only the selected region
      const vidBoxX = (boundingBox.startX - offsetX) * scaleX;
      const vidBoxY = (boundingBox.startY - offsetY) * scaleY;
      const vidBoxWidth = (boundingBox.endX - boundingBox.startX) * scaleX;
      const vidBoxHeight = (boundingBox.endY - boundingBox.startY) * scaleY;
      
      // Make sure we're not trying to draw outside the video bounds
      if (vidBoxX >= 0 && vidBoxY >= 0 && 
          vidBoxWidth > 0 && vidBoxHeight > 0 && 
          vidBoxX + vidBoxWidth <= video.videoWidth && 
          vidBoxY + vidBoxHeight <= video.videoHeight) {
        ctx.drawImage(
          video, 
          vidBoxX, vidBoxY, vidBoxWidth, vidBoxHeight, // Source rectangle
          0, 0, canvas.width, canvas.height // Destination rectangle
        );
      } else {
        // Fallback to full frame if coordinates are invalid
        console.warn("[ScreenShare] Invalid region selection, showing full frame");
        ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
        resetBoundingBox();
      }
    }
    
    // Draw selection overlay while selecting
    if (isSelecting && selectionStart && boundingBox) {
      // Semi-transparent overlay on the entire canvas except the selection
      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Clear the selected area to make it visible
      ctx.clearRect(
        boundingBox.startX,
        boundingBox.startY,
        boundingBox.endX - boundingBox.startX,
        boundingBox.endY - boundingBox.startY
      );
      
      // Draw red border around selection
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        boundingBox.startX,
        boundingBox.startY,
        boundingBox.endX - boundingBox.startX,
        boundingBox.endY - boundingBox.startY
      );
    }
  }, [boundingBox, isSelecting, resetBoundingBox, selectionStart, showFullScreen]);

  // Set up animation loop for canvas drawing
  useEffect(() => {
    if (!stream || stream.getVideoTracks().length === 0) {
      return;
    }

    let isActive = true;
    
    const animate = () => {
      if (!isActive) return;
      
      drawVideoFrame();
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();

    return () => {
      isActive = false;
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [stream, drawVideoFrame]);

  // Set up video element when stream is available
  useEffect(() => {
    if (!stream || stream.getVideoTracks().length === 0 || !videoRef.current) {
      return;
    }
    
    const video = videoRef.current;
    let isActive = true;
    
    // Clean up previous video state
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
    
    video.srcObject = stream;
    
    // Create a safe play function that handles errors
    const safePlay = async () => {
      if (!isActive || !video) return;
      
      try {
        await video.play();
      } catch (error: any) {
        if (error.name === "AbortError") {
          console.log("[ScreenShare] Play aborted, likely due to source change");
        } else if (error.name === "NotAllowedError") {
          console.warn("[ScreenShare] Autoplay prevented:", error);
        } else {
          console.error("[ScreenShare] Video play failed:", error);
        }
      }
    };
    
    // Try to play when metadata is loaded
    video.onloadedmetadata = () => {
      safePlay();
    };
    
    // If already loaded, try playing
    if (video.readyState >= 2) {
      safePlay();
    }

    return () => {
      isActive = false;
      if (video) {
        video.onloadedmetadata = null;
        video.pause();
        video.srcObject = null;
      }
    };
  }, [stream]);

  // Keyboard handlers for accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape key to cancel selection or reset bounding box
      if (e.key === 'Escape') {
        if (isSelecting) {
          setIsSelecting(false);
          setSelectionStart(null);
        } else if (!showFullScreen) {
          resetBoundingBox();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelecting, resetBoundingBox, showFullScreen]);

  if (!stream || stream.getVideoTracks().length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white rounded-lg">
        <span>No screen share available</span>
      </div>
    );
  }

  return (
    <>
      <div className="relative" aria-label="Screen sharing viewer">
        <video 
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="hidden"
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="w-full h-full rounded-lg cursor-crosshair"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          role="application"
          aria-label="Screen sharing canvas. Click and drag to select a region."
          tabIndex={0}
        />
        <div className="absolute top-2 right-2 bg-black/50 text-white px-2 py-1 rounded text-sm flex gap-2 items-center">
          {!showFullScreen && (
            <button 
              onClick={resetBoundingBox}
              className="bg-blue-500 text-white rounded px-2 py-0.5 text-xs hover:bg-blue-600 transition"
              aria-label="Reset selection"
            >
              Reset
            </button>
          )}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="inline-flex items-center">
                {frameRate} FPS
              </TooltipTrigger>
              <TooltipContent>
                <p>Current screen sharing frame rate</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {!isSelecting && showFullScreen && (
          <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
            Click and drag to select a region to focus on
          </div>
        )}
      </div>
    </>
  );
}

interface ScreenShareProps {
  onStreamReady: (stream: MediaStream) => void;
  frameRate: number;
  selectedAudioDeviceId?: string;
}

/**
 * ScreenShare component that manages screen sharing capabilities
 */
export function ScreenShare({ onStreamReady, frameRate = 30, selectedAudioDeviceId = "none" }: ScreenShareProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up current stream and set a new one
  const replaceStream = useCallback((newStream: MediaStream | null) => {
    setStream((oldStream) => {
      if (oldStream) {
        oldStream.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = newStream;
      return newStream;
    });
  }, []);

  // Start screen sharing session
  const startScreenShare = useCallback(async () => {
    
    if (frameRate === 0) {
      return null;
    }

    console.log("[ScreenShare] Attempting to start screen share");
    try {
      setError(null);
      
      // Check browser support
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        setError("Screen sharing not supported in this browser");
        return null;
      }

      // Create constraints with safe fallbacks
      const constraints: MediaStreamConstraints = {
        video: {
          frameRate: frameRate > 0 ? { ideal: frameRate, max: Math.min(frameRate * 1.5, 60) } : undefined,
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
        },
        audio: false, // We'll handle audio separately if needed
      };

      // Use getDisplayMedia with retry mechanism for AbortErrors
      let retries = 0;
      const maxRetries = 2;
      let lastError: Error | null = null;
      
      while (retries <= maxRetries) {
        try {
          const newStream = await navigator.mediaDevices.getDisplayMedia(constraints);
          
          // Apply frameRate to video tracks manually if needed
          if (frameRate > 0 && newStream.getVideoTracks().length > 0) {
            const videoTrack = newStream.getVideoTracks()[0];
            try {
              const settings = videoTrack.getSettings();
              console.log("[ScreenShare] Initial screen share settings:", settings);
              
              if (videoTrack.applyConstraints) {
                await videoTrack.applyConstraints({
                  frameRate: { ideal: frameRate, max: Math.min(frameRate * 1.5, 60) },
                  width: { ideal: 1280, max: 1920 },
                  height: { ideal: 720, max: 1080 },
                });
                console.log(`[ScreenShare] Applied constraints to screen share track`);
              }
            } catch (applyError) {
              console.warn("[ScreenShare] Couldn't apply frameRate constraint:", applyError);
            }
          }
          
          // Add audio track if audio device is selected
          if (selectedAudioDeviceId && selectedAudioDeviceId !== "none") {
            try {
              console.log(`[ScreenShare] Adding audio from device: ${selectedAudioDeviceId}`);
              const audioConstraints: MediaStreamConstraints = {
                audio: {
                  deviceId: { exact: selectedAudioDeviceId },
                  sampleRate: 48000,
                  channelCount: 2,
                  sampleSize: 16,
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                }
              };
              
              const audioStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
              const audioTrack = audioStream.getAudioTracks()[0];
              
              if (audioTrack) {
                newStream.addTrack(audioTrack);
                console.log("[ScreenShare] Successfully added audio track");
              }
            } catch (audioError) {
              console.error("[ScreenShare] Failed to add audio track:", audioError);
            }
          }
          
          // Handle stream stop when user clicks "Stop Sharing"
          const videoTrack = newStream.getVideoTracks()[0];
          if (videoTrack) {
            videoTrack.onended = () => {
              console.log("[ScreenShare] User ended screen sharing");
              replaceStream(null);
            };
          }

          return newStream;
        } catch (error: any) {
          lastError = error;
          
          if (error.name === "NotAllowedError") {
            console.warn("[ScreenShare] User denied screen sharing permission");
            setError("Screen sharing permission denied");
            break;
          } else if (error.name === "AbortError" && error.message === "Invalid state") {
            console.warn(`[ScreenShare] AbortError: Invalid state (Retry ${retries + 1}/${maxRetries + 1})`);
            retries++;
            // Add a short delay before retrying
            await new Promise(resolve => setTimeout(resolve, 300));
          } else {
            // For other errors, break immediately
            break;
          }
        }
      }
      
      // If we've exhausted retries or have another error
      if (lastError) {
        console.error("[ScreenShare] Error accessing screen sharing:", lastError);
        setError(`Screen sharing error: ${lastError.message || lastError.name}`);
      }
      return null;
    } catch (error: any) {
      console.error("[ScreenShare] Error accessing screen sharing:", error);
      setError(`Screen sharing error: ${error.message || "Unknown error"}`);
      return null;
    }
  }, [frameRate, replaceStream, selectedAudioDeviceId]);

  // Initialize screen sharing when component mounts or frameRate changes
  useEffect(() => {
    if (frameRate === 0) return;

    let isComponentMounted = true;
    console.log("[ScreenShare] Starting screen share with frame rate:", frameRate, "audio device:", selectedAudioDeviceId);
    
    startScreenShare().then((newStream) => {
      // Only proceed if component is still mounted
      if (!isComponentMounted) {
        if (newStream) {
          newStream.getTracks().forEach(track => track.stop());
        }
        return;
      }
      
      if (newStream) {
        console.log("[ScreenShare] Screen share stream obtained:", 
          `Video tracks: ${newStream.getVideoTracks().length}`,
          `Audio tracks: ${newStream.getAudioTracks().length}`
        );
        
        replaceStream(newStream);
        
        // Log track information
        newStream.getTracks().forEach(track => {
          console.log(`[ScreenShare] Track: kind=${track.kind}, enabled=${track.enabled}, id=${track.id}`);
          const settings = track.getSettings();
          console.log("[ScreenShare] Track settings:", settings);
        });
        
        // Canvas will handle passing the processed stream to onStreamReady
        // We don't call onStreamReady(newStream) directly anymore
      } else {
        console.warn("[ScreenShare] Failed to get screen share stream");
      }
    }).catch(error => {
      if (isComponentMounted) {
        console.error("[ScreenShare] Error in screen sharing effect:", error);
        setError(`Screen sharing error: ${error.message || "Unknown error"}`);
      }
    });

    return () => {
      isComponentMounted = false;
      console.log("[ScreenShare] Cleaning up screen share");
      
      // Ensure we stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            console.warn("[ScreenShare] Error stopping track:", e);
          }
        });
      }
      
      replaceStream(null);
    };
  }, [frameRate, startScreenShare, replaceStream, onStreamReady, selectedAudioDeviceId]);

  // Show error message if there's an error
  if (error) {
    return (
      <div className="w-full p-4 bg-red-100 border border-red-300 rounded-lg text-red-700">
        <p>{error}</p>
        <button 
          onClick={() => startScreenShare()}
          className="mt-2 bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition"
        >
          Try Again
        </button>
      </div>
    );
  }

  // Don't render anything until we have a stream
  if (!stream || stream.getVideoTracks().length === 0) {
    return null;
  }

  return (
    <div className="screen-share-container">
      <StreamCanvas
        stream={stream}
        frameRate={frameRate}
        onStreamReady={onStreamReady}
      />
    </div>
  );
} 