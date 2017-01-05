define(function () {
return "@export qtek.sm.depth.vertex\n\nuniform mat4 worldViewProjection : WORLDVIEWPROJECTION;\n\nattribute vec3 position : POSITION;\n\n#ifdef SHADOW_TRANSPARENT\nattribute vec2 texcoord : TEXCOORD_0;\n#endif\n\n#ifdef SKINNING\nattribute vec3 weight : WEIGHT;\nattribute vec4 joint : JOINT;\n\nuniform mat4 skinMatrix[JOINT_COUNT] : SKIN_MATRIX;\n#endif\n\nvarying vec4 v_ViewPosition;\n\n#ifdef SHADOW_TRANSPARENT\nvarying vec2 v_Texcoord;\n#endif\n\nvoid main(){\n\n    vec3 skinnedPosition = position;\n\n#ifdef SKINNING\n\n    @import qtek.chunk.skin_matrix\n\n    skinnedPosition = (skinMatrixWS * vec4(position, 1.0)).xyz;\n#endif\n\n    v_ViewPosition = worldViewProjection * vec4(skinnedPosition, 1.0);\n    gl_Position = v_ViewPosition;\n\n#ifdef SHADOW_TRANSPARENT\n    v_Texcoord = texcoord;\n#endif\n}\n@end\n\n@export qtek.sm.depth.fragment\n\nvarying vec4 v_ViewPosition;\n\n#ifdef SHADOW_TRANSPARENT\nvarying vec2 v_Texcoord;\n#endif\n\nuniform float bias : 0.001;\nuniform float slopeScale : 1.0;\n\n#ifdef SHADOW_TRANSPARENT\nuniform sampler2D transparentMap;\n#endif\n\n@import qtek.util.encode_float\n\nvoid main(){\n    // Whats the difference between gl_FragCoord.z and this v_ViewPosition\n    // gl_FragCoord consider the polygon offset ?\n    float depth = v_ViewPosition.z / v_ViewPosition.w;\n    // float depth = gl_FragCoord.z / gl_FragCoord.w;\n\n#ifdef USE_VSM\n    depth = depth * 0.5 + 0.5;\n    float moment1 = depth;\n    float moment2 = depth * depth;\n\n    // Adjusting moments using partial derivative\n    float dx = dFdx(depth);\n    float dy = dFdy(depth);\n    moment2 += 0.25*(dx*dx+dy*dy);\n\n    gl_FragColor = vec4(moment1, moment2, 0.0, 1.0);\n#else\n    // Add slope scaled bias using partial derivative\n    float dx = dFdx(depth);\n    float dy = dFdy(depth);\n    depth += sqrt(dx*dx + dy*dy) * slopeScale + bias;\n\n#ifdef SHADOW_TRANSPARENT\n    if (texture2D(transparentMap, v_Texcoord).a <= 0.1) {\n        // Hi-Z\n        gl_FragColor = encodeFloat(0.9999);\n        return;\n    }\n#endif\n\n    gl_FragColor = encodeFloat(depth * 0.5 + 0.5);\n#endif\n}\n@end\n\n@export qtek.sm.debug_depth\n\nuniform sampler2D depthMap;\nvarying vec2 v_Texcoord;\n\n@import qtek.util.decode_float\n\nvoid main() {\n    vec4 tex = texture2D(depthMap, v_Texcoord);\n#ifdef USE_VSM\n    gl_FragColor = vec4(tex.rgb, 1.0);\n#else\n    float depth = decodeFloat(tex);\n    gl_FragColor = vec4(depth, depth, depth, 1.0);\n#endif\n}\n\n@end\n\n\n@export qtek.sm.distance.vertex\n\nuniform mat4 worldViewProjection : WORLDVIEWPROJECTION;\nuniform mat4 world : WORLD;\n\nattribute vec3 position : POSITION;\n\n#ifdef SKINNING\nattribute vec3 boneWeight;\nattribute vec4 boneIndex;\n\nuniform mat4 skinMatrix[JOINT_COUNT] : SKIN_MATRIX;\n#endif\n\nvarying vec3 v_WorldPosition;\n\nvoid main (){\n\n    vec3 skinnedPosition = position;\n#ifdef SKINNING\n    @import qtek.chunk.skin_matrix\n\n    skinnedPosition = (skinMatrixWS * vec4(position, 1.0)).xyz;\n#endif\n\n    gl_Position = worldViewProjection * vec4(skinnedPosition , 1.0);\n    v_WorldPosition = (world * vec4(skinnedPosition, 1.0)).xyz;\n}\n\n@end\n\n@export qtek.sm.distance.fragment\n\nuniform vec3 lightPosition;\nuniform float range : 100;\n\nvarying vec3 v_WorldPosition;\n\n@import qtek.util.encode_float\n\nvoid main(){\n    float dist = distance(lightPosition, v_WorldPosition);\n#ifdef USE_VSM\n    gl_FragColor = vec4(dist, dist * dist, 0.0, 0.0);\n#else\n    dist = dist / range;\n    gl_FragColor = encodeFloat(dist);\n#endif\n}\n@end\n\n@export qtek.plugin.shadow_map_common\n\n@import qtek.util.decode_float\n\nfloat tapShadowMap(sampler2D map, vec2 uv, float z){\n    vec4 tex = texture2D(map, uv);\n    // FIXME premultiplied alpha?\n    // tex.rgb /= tex.a;\n    return step(z, decodeFloat(tex) * 2.0 - 1.0);\n}\n\nfloat pcf(sampler2D map, vec2 uv, float z, float textureSize, vec2 scale) {\n\n    float shadowContrib = tapShadowMap(map, uv, z);\n    vec2 offset = vec2(1.0 / textureSize) * scale;\n    shadowContrib += tapShadowMap(map, uv+vec2(offset.x, 0.0), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(offset.x, offset.y), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(-offset.x, offset.y), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(0.0, offset.y), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(-offset.x, 0.0), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(-offset.x, -offset.y), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(offset.x, -offset.y), z);\n    shadowContrib += tapShadowMap(map, uv+vec2(0.0, -offset.y), z);\n\n    return shadowContrib / 9.0;\n}\n\nfloat pcf(sampler2D map, vec2 uv, float z, float textureSize) {\n    return pcf(map, uv, z, textureSize, vec2(1.0));\n}\n\nfloat chebyshevUpperBound(vec2 moments, float z){\n    float p = 0.0;\n    z = z * 0.5 + 0.5;\n    if (z <= moments.x) {\n        p = 1.0;\n    }\n    float variance = moments.y - moments.x * moments.x;\n    // http://fabiensanglard.net/shadowmappingVSM/\n    variance = max(variance, 0.0000001);\n    // Compute probabilistic upper bound.\n    float mD = moments.x - z;\n    float pMax = variance / (variance + mD * mD);\n    // Now reduce light-bleeding by removing the [0, x] tail and linearly rescaling (x, 1]\n    // TODO : bleedBias parameter ?\n    pMax = clamp((pMax-0.4)/(1.0-0.4), 0.0, 1.0);\n    return max(p, pMax);\n}\nfloat computeShadowContrib(\n    sampler2D map, mat4 lightVPM, vec3 position, float textureSize, vec2 scale, vec2 offset\n) {\n\n    vec4 posInLightSpace = lightVPM * vec4(position, 1.0);\n    posInLightSpace.xyz /= posInLightSpace.w;\n    float z = posInLightSpace.z;\n    // In frustum\n    if(all(greaterThan(posInLightSpace.xyz, vec3(-0.99, -0.99, -1.0))) &&\n        all(lessThan(posInLightSpace.xyz, vec3(0.99, 0.99, 1.0)))){\n        // To texture uv\n        vec2 uv = (posInLightSpace.xy+1.0) / 2.0;\n\n        #ifdef USE_VSM\n            vec2 moments = texture2D(map, uv * scale + offset).xy;\n            return chebyshevUpperBound(moments, z);\n        #else\n            return pcf(map, uv * scale + offset, z, textureSize, scale);\n        #endif\n    }\n    return 1.0;\n}\n\nfloat computeShadowContrib(sampler2D map, mat4 lightVPM, vec3 position, float textureSize) {\n    return computeShadowContrib(map, lightVPM, position, textureSize, vec2(1.0), vec2(0.0));\n}\n\nfloat computeShadowContribOmni(samplerCube map, vec3 direction, float range)\n{\n    float dist = length(direction);\n    vec4 shadowTex = textureCube(map, direction);\n\n#ifdef USE_VSM\n    vec2 moments = shadowTex.xy;\n    float variance = moments.y - moments.x * moments.x;\n    float mD = moments.x - dist;\n    float p = variance / (variance + mD * mD);\n    if(moments.x + 0.001 < dist){\n        return clamp(p, 0.0, 1.0);\n    }else{\n        return 1.0;\n    }\n#else\n    return step(dist, (decodeFloat(shadowTex) + 0.0002) * range);\n#endif\n}\n\n@end\n\n\n\n@export qtek.plugin.compute_shadow_map\n\n#if defined(SPOT_LIGHT_SHADOWMAP_COUNT) || defined(DIRECTIONAL_LIGHT_SHADOWMAP_COUNT) || defined(POINT_LIGHT_SHADOWMAP_COUNT)\n\n#ifdef SPOT_LIGHT_SHADOWMAP_COUNT\nuniform sampler2D spotLightShadowMaps[SPOT_LIGHT_SHADOWMAP_COUNT];\nuniform mat4 spotLightMatrices[SPOT_LIGHT_SHADOWMAP_COUNT];\nuniform float spotLightShadowMapSizes[SPOT_LIGHT_SHADOWMAP_COUNT];\n#endif\n\n#ifdef DIRECTIONAL_LIGHT_SHADOWMAP_COUNT\n#if defined(SHADOW_CASCADE)\nuniform sampler2D directionalLightShadowMaps[1];\nuniform mat4 directionalLightMatrices[SHADOW_CASCADE];\nuniform float directionalLightShadowMapSizes[1];\nuniform float shadowCascadeClipsNear[SHADOW_CASCADE];\nuniform float shadowCascadeClipsFar[SHADOW_CASCADE];\n#else\nuniform sampler2D directionalLightShadowMaps[DIRECTIONAL_LIGHT_SHADOWMAP_COUNT];\nuniform mat4 directionalLightMatrices[DIRECTIONAL_LIGHT_SHADOWMAP_COUNT];\nuniform float directionalLightShadowMapSizes[DIRECTIONAL_LIGHT_SHADOWMAP_COUNT];\n#endif\n#endif\n\n#ifdef POINT_LIGHT_SHADOWMAP_COUNT\nuniform samplerCube pointLightShadowMaps[POINT_LIGHT_SHADOWMAP_COUNT];\nuniform float pointLightShadowMapSizes[POINT_LIGHT_SHADOWMAP_COUNT];\n#endif\n\nuniform bool shadowEnabled : true;\n\n@import qtek.plugin.shadow_map_common\n\n#if defined(SPOT_LIGHT_SHADOWMAP_COUNT)\n\nvoid computeShadowOfSpotLights(vec3 position, inout float shadowContribs[SPOT_LIGHT_COUNT] ){\n    for(int i = 0; i < SPOT_LIGHT_SHADOWMAP_COUNT; i++) {\n        float shadowContrib = computeShadowContrib(\n            spotLightShadowMaps[i], spotLightMatrices[i], position,\n            spotLightShadowMapSizes[i]\n        );\n        shadowContribs[i] = shadowContrib;\n    }\n    // set default fallof of rest lights\n    for(int i = SPOT_LIGHT_SHADOWMAP_COUNT; i < SPOT_LIGHT_COUNT; i++){\n        shadowContribs[i] = 1.0;\n    }\n}\n\n#endif\n\n\n#if defined(DIRECTIONAL_LIGHT_SHADOWMAP_COUNT)\n\n#ifdef SHADOW_CASCADE\n\nvoid computeShadowOfDirectionalLights(vec3 position, inout float shadowContribs[DIRECTIONAL_LIGHT_COUNT]){\n    // http://www.opengl.org/wiki/Compute_eye_space_from_window_space\n    float depth = (2.0 * gl_FragCoord.z - gl_DepthRange.near - gl_DepthRange.far)\n                    / (gl_DepthRange.far - gl_DepthRange.near);\n\n    // Pixels not in light box are lighted\n    // TODO\n    shadowContribs[0] = 1.0;\n\n    for (int i = 0; i < SHADOW_CASCADE; i++) {\n        if (\n            depth >= shadowCascadeClipsNear[i] &&\n            depth <= shadowCascadeClipsFar[i]\n        ) {\n            float shadowContrib = computeShadowContrib(\n                directionalLightShadowMaps[0], directionalLightMatrices[i], position,\n                directionalLightShadowMapSizes[0],\n                vec2(1.0 / float(SHADOW_CASCADE), 1.0),\n                vec2(float(i) / float(SHADOW_CASCADE), 0.0)\n            );\n            // TODO Will get a sampler needs to be be uniform error in native gl\n            shadowContribs[0] = shadowContrib;\n        }\n    }\n    // set default fallof of rest lights\n    for(int i = DIRECTIONAL_LIGHT_SHADOWMAP_COUNT; i < DIRECTIONAL_LIGHT_COUNT; i++){\n        shadowContribs[i] = 1.0;\n    }\n}\n\n#else\n\nvoid computeShadowOfDirectionalLights(vec3 position, inout float shadowContribs[DIRECTIONAL_LIGHT_COUNT]){\n    for(int i = 0; i < DIRECTIONAL_LIGHT_SHADOWMAP_COUNT; i++){\n        float shadowContrib = computeShadowContrib(\n            directionalLightShadowMaps[i], directionalLightMatrices[i], position,\n            directionalLightShadowMapSizes[i]\n        );\n        shadowContribs[i] = shadowContrib;\n    }\n    // set default fallof of rest lights\n    for(int i = DIRECTIONAL_LIGHT_SHADOWMAP_COUNT; i < DIRECTIONAL_LIGHT_COUNT; i++){\n        shadowContribs[i] = 1.0;\n    }\n}\n#endif\n\n#endif\n\n\n#if defined(POINT_LIGHT_SHADOWMAP_COUNT)\n\nvoid computeShadowOfPointLights(vec3 position, inout float shadowContribs[POINT_LIGHT_COUNT] ){\n    for(int i = 0; i < POINT_LIGHT_SHADOWMAP_COUNT; i++){\n        vec3 lightPosition = pointLightPosition[i];\n        vec3 direction = position - lightPosition;\n        shadowContribs[i] = computeShadowContribOmni(pointLightShadowMaps[i], direction, pointLightRange[i]);\n    }\n    for(int i = POINT_LIGHT_SHADOWMAP_COUNT; i < POINT_LIGHT_COUNT; i++){\n        shadowContribs[i] = 1.0;\n    }\n}\n\n#endif\n\n#endif\n\n@end";
});