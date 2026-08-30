# Currently granted host capabilities

This file describes the complete host capability surface available in the current version.
An omitted or removed capability must not be declared, imported, or simulated through ambient WASI authority.
Every listed function uses `(input_pointer, input_length, output_pointer, output_capacity) -> output_length` and exchanges UTF-8 JSON.

### audit.append_email_change

Import `air_audit_v1.append_email_change` with the existing four-i32 JSON operation ABI.
Input {user_id,old_email,new_email}. Returns {ok:true}.

### users.get

Import `air_users_v1.get_user` with the existing four-i32 JSON operation ABI.
Input {id}. Returns {ok:true,user} including internal storage fields, or {ok:false,error:not_found}. The guest must filter public output, including audit records and audit metadata, from every user endpoint response.

### users.insert

Import `air_users_v1.insert_user` with the existing four-i32 JSON operation ABI.
Input {name,email,verified?,status?}. Returns {ok:true,id} or {ok:false,error:duplicate_email}.

### users.update_email

Import `air_users_v1.update_email` with the existing four-i32 JSON operation ABI.
Input {id,email}. Returns {ok:true}, duplicate_email, or not_found.

### users.update_name

Import `air_users_v1.update_name` with the existing four-i32 JSON operation ABI.
Input {id,name}. Returns {ok:true} or {ok:false,error:not_found}.
