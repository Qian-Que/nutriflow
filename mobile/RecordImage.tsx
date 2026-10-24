import { useEffect, useState } from 'react';
import { Image, Platform, View, type ImageStyle, type StyleProp } from 'react-native';

export function RecordImage({ uri, baseUrl, token, style }: {uri:string;baseUrl:string;token:string;style:StyleProp<ImageStyle>}) {
  const privateImage = /^\/api\/(?:logs|recognition\/jobs)\/[a-zA-Z0-9-]+\/image(?:\?size=thumb)?$/.test(uri);
  const url = privateImage ? baseUrl + uri : uri;
  const [webUri,setWebUri] = useState<string>();
  useEffect(() => {
    if (Platform.OS !== 'web' || !privateImage) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    setWebUri(undefined);
    void fetch(url,{headers:{Authorization:`Bearer ${token}`},signal:abort.signal})
      .then(response=>{if(!response.ok)throw new Error('image unavailable');return response.blob();})
      .then(blob=>{if(!abort.signal.aborted){objectUrl=URL.createObjectURL(blob);setWebUri(objectUrl);}}).catch(()=>{});
    return ()=>{abort.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[url,token,privateImage]);
  if (privateImage && Platform.OS === 'web') return webUri ? <Image source={{uri:webUri}} style={style}/> : <View style={style}/>;
  return <Image source={privateImage ? {uri:url,headers:{Authorization:`Bearer ${token}`}} : {uri:url}} style={style}/>;
}
